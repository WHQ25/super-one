#import "VoiceAudioDevice.h"
#import <AVFoundation/AVFoundation.h>
#import <AudioToolbox/AudioToolbox.h>
#import <react-native-webrtc/WebRTCModuleOptions.h>
#import <stdatomic.h>

NSNotificationName const SOVoiceInterrupted = @"SOVoiceInterrupted";
NSNotificationName const SOVoiceBufferError = @"SOVoiceBufferError";
static const UInt32 kRate = 48000;
static const UInt32 kFrames = 480;
static const UInt32 kCapacity = 48000 * 300;

@implementation SOVoiceAudioDevice {
  id<RTCAudioDeviceDelegate> _delegate;
  AudioUnit _unit;
  dispatch_queue_t _producerQueue;
  dispatch_source_t _producer;
  NSLock *_lock;
  int16_t *_samples;
  UInt32 _head, _count;
  atomic_bool _paused, _playing, _recording;
  BOOL _initialized, _playoutInitialized, _recordInitialized, _call, _interrupted, _failed;
}
+ (instancetype)shared { static SOVoiceAudioDevice *device; static dispatch_once_t once; dispatch_once(&once, ^{ device = [self new]; }); return device; }
+ (void)load {
  // Installed before RN constructs its PeerConnectionFactory. The default ADM
  // bypasses JS and cannot retain decoded audio across a pause.
  [WebRTCModuleOptions sharedInstance].audioDevice = [self shared];
}
- (instancetype)init {
  if ((self = [super init])) {
    _lock = [NSLock new]; _producerQueue = dispatch_queue_create("superone.voice.pcm", DISPATCH_QUEUE_SERIAL);
    _samples = calloc(kCapacity, sizeof(int16_t));
    [[NSNotificationCenter defaultCenter] addObserver:self selector:@selector(interruption:) name:AVAudioSessionInterruptionNotification object:nil];
    [[NSNotificationCenter defaultCenter] addObserver:self selector:@selector(routeChanged:) name:AVAudioSessionRouteChangeNotification object:nil];
  }
  return self;
}
- (void)dealloc { [[NSNotificationCenter defaultCenter] removeObserver:self]; free(_samples); }
- (BOOL)beginCall:(NSError **)error { _call = YES; _failed = NO; atomic_store(&_paused, false); return [self activate:error]; }
- (BOOL)activate:(NSError **)error {
  AVAudioSession *session = AVAudioSession.sharedInstance;
  if (![session setCategory:AVAudioSessionCategoryPlayAndRecord mode:AVAudioSessionModeVoiceChat options:AVAudioSessionCategoryOptionAllowBluetooth | AVAudioSessionCategoryOptionDefaultToSpeaker error:error]) return NO;
  [session setPreferredSampleRate:kRate error:nil]; [session setPreferredIOBufferDuration:0.01 error:nil];
  return [session setActive:YES error:error];
}
- (void)pause { atomic_store(&_paused, true); }
- (BOOL)resume:(NSError **)error {
  if (_interrupted) { if (error) *error = [NSError errorWithDomain:@"SuperOneVoice" code:1 userInfo:@{NSLocalizedDescriptionKey: @"Audio is still interrupted. Try again when the other call ends."}]; return NO; }
  if (![self activate:error]) return NO;
  if (_unit && AudioOutputUnitStart(_unit) != noErr) return NO;
  atomic_store(&_paused, false); return YES;
}
- (void)endCall { [self pause]; _call = NO; [_lock lock]; _head = 0; _count = 0; [_lock unlock]; }
- (void)interruption:(NSNotification *)notification {
  if (!_call) return;
  _interrupted = [notification.userInfo[AVAudioSessionInterruptionTypeKey] unsignedIntegerValue] == AVAudioSessionInterruptionTypeBegan;
  if (_interrupted) {
    [self pause]; if (_unit) AudioOutputUnitStop(_unit);
    [[NSNotificationCenter defaultCenter] postNotificationName:SOVoiceInterrupted object:nil];
    [_delegate dispatchAsync:^{ [self->_delegate notifyAudioInputInterrupted]; [self->_delegate notifyAudioOutputInterrupted]; }];
  }
  // Interruption end deliberately leaves the queue paused until explicit Play.
}
- (void)routeChanged:(NSNotification *)notification {
  if (!_delegate) return;
  [_delegate dispatchAsync:^{ [self->_delegate notifyAudioInputParametersChange]; [self->_delegate notifyAudioOutputParametersChange]; }];
}
- (double)deviceInputSampleRate { return kRate; }
- (double)deviceOutputSampleRate { return kRate; }
- (NSTimeInterval)inputIOBufferDuration { return 0.01; }
- (NSTimeInterval)outputIOBufferDuration { return 0.01; }
- (NSInteger)inputNumberOfChannels { return 1; }
- (NSInteger)outputNumberOfChannels { return 1; }
- (NSTimeInterval)inputLatency { return AVAudioSession.sharedInstance.inputLatency; }
- (NSTimeInterval)outputLatency { return AVAudioSession.sharedInstance.outputLatency; }
- (BOOL)isInitialized { return _initialized; }
- (BOOL)isPlayoutInitialized { return _playoutInitialized; }
- (BOOL)isRecordingInitialized { return _recordInitialized; }
- (BOOL)isPlaying { return atomic_load(&_playing); }
- (BOOL)isRecording { return atomic_load(&_recording); }

static OSStatus renderOutput(void *ref, AudioUnitRenderActionFlags *flags, const AudioTimeStamp *time, UInt32 bus, UInt32 frames, AudioBufferList *data) {
  SOVoiceAudioDevice *self = (__bridge SOVoiceAudioDevice *)ref;
  for (UInt32 b = 0; b < data->mNumberBuffers; b++) memset(data->mBuffers[b].mData, 0, data->mBuffers[b].mDataByteSize);
  if (atomic_load(&self->_paused)) return noErr;
  [self->_lock lock];
  UInt32 count = MIN(frames, self->_count);
  int16_t *out = data->mBuffers[0].mData;
  for (UInt32 i = 0; i < count; i++) out[i] = self->_samples[(self->_head + i) % kCapacity];
  self->_head = (self->_head + count) % kCapacity; self->_count -= count;
  [self->_lock unlock]; return noErr;
}
static OSStatus recordInput(void *ref, AudioUnitRenderActionFlags *flags, const AudioTimeStamp *time, UInt32 bus, UInt32 frames, AudioBufferList *ignored) {
  SOVoiceAudioDevice *self = (__bridge SOVoiceAudioDevice *)ref;
  if (!atomic_load(&self->_recording) || frames > 4096) return noErr;
  int16_t samples[4096]; AudioBufferList data = { .mNumberBuffers = 1, .mBuffers = {{ .mNumberChannels = 1, .mDataByteSize = frames * 2, .mData = samples }} };
  OSStatus status = AudioUnitRender(self->_unit, flags, time, 1, frames, &data);
  if (status != noErr) return status;
  if (atomic_load(&self->_paused)) memset(samples, 0, frames * 2);
  return self->_delegate.deliverRecordedData(flags, time, bus, frames, &data, NULL, nil);
}
- (BOOL)initializeWithDelegate:(id<RTCAudioDeviceDelegate>)delegate { _delegate = delegate; _initialized = YES; return YES; }
- (BOOL)prepareUnit {
  if (_unit) return YES;
  AudioComponentDescription description = { .componentType = kAudioUnitType_Output, .componentSubType = kAudioUnitSubType_VoiceProcessingIO, .componentManufacturer = kAudioUnitManufacturer_Apple };
  AudioComponent component = AudioComponentFindNext(NULL, &description);
  if (!component || AudioComponentInstanceNew(component, &_unit) != noErr) return NO;
  UInt32 enabled = 1;
  AudioStreamBasicDescription format = { .mSampleRate = kRate, .mFormatID = kAudioFormatLinearPCM, .mFormatFlags = kLinearPCMFormatFlagIsSignedInteger | kLinearPCMFormatFlagIsPacked, .mBytesPerPacket = 2, .mFramesPerPacket = 1, .mBytesPerFrame = 2, .mChannelsPerFrame = 1, .mBitsPerChannel = 16 };
  AURenderCallbackStruct output = { renderOutput, (__bridge void *)self }, input = { recordInput, (__bridge void *)self };
  OSStatus status = AudioUnitSetProperty(_unit, kAudioOutputUnitProperty_EnableIO, kAudioUnitScope_Input, 1, &enabled, sizeof(enabled));
  status |= AudioUnitSetProperty(_unit, kAudioUnitProperty_StreamFormat, kAudioUnitScope_Input, 0, &format, sizeof(format));
  status |= AudioUnitSetProperty(_unit, kAudioUnitProperty_StreamFormat, kAudioUnitScope_Output, 1, &format, sizeof(format));
  status |= AudioUnitSetProperty(_unit, kAudioUnitProperty_SetRenderCallback, kAudioUnitScope_Input, 0, &output, sizeof(output));
  status |= AudioUnitSetProperty(_unit, kAudioOutputUnitProperty_SetInputCallback, kAudioUnitScope_Global, 1, &input, sizeof(input));
  status |= AudioUnitInitialize(_unit);
  if (status != noErr) { AudioComponentInstanceDispose(_unit); _unit = NULL; return NO; }
  return YES;
}
- (BOOL)initializePlayout { return _playoutInitialized = [self prepareUnit]; }
- (BOOL)initializeRecording { return _recordInitialized = [self prepareUnit]; }
- (BOOL)startPlayout {
  atomic_store(&_playing, true);
  if (!_producer) {
    _producer = dispatch_source_create(DISPATCH_SOURCE_TYPE_TIMER, 0, 0, _producerQueue);
    dispatch_source_set_timer(_producer, DISPATCH_TIME_NOW, 10 * NSEC_PER_MSEC, NSEC_PER_MSEC);
    dispatch_source_set_event_handler(_producer, ^{ [self produce]; }); dispatch_resume(_producer);
  }
  return AudioOutputUnitStart(_unit) == noErr;
}
- (void)produce {
  if (!atomic_load(&_playing) || !_delegate || _failed) return;
  int16_t samples[kFrames]; AudioBufferList data = { .mNumberBuffers = 1, .mBuffers = {{ .mNumberChannels = 1, .mDataByteSize = kFrames * 2, .mData = samples }} };
  AudioUnitRenderActionFlags flags = 0; AudioTimeStamp time = {0};
  if (_delegate.getPlayoutData(&flags, &time, 0, kFrames, &data) != noErr) return;
  BOOL audible = NO; for (UInt32 i = 0; i < kFrames; i++) if (samples[i]) { audible = YES; break; }
  [_lock lock];
  if (!atomic_load(&_paused) && !audible && _count > kFrames * 2) { [_lock unlock]; return; }
  if (_count + kFrames > kCapacity) {
    _failed = YES; atomic_store(&_paused, true); [_lock unlock];
    [[NSNotificationCenter defaultCenter] postNotificationName:SOVoiceBufferError object:nil]; return;
  }
  for (UInt32 i = 0; i < kFrames; i++) _samples[(_head + _count + i) % kCapacity] = samples[i];
  _count += kFrames; [_lock unlock];
}
- (BOOL)startRecording { atomic_store(&_recording, true); return AudioOutputUnitStart(_unit) == noErr; }
- (BOOL)stopRecording { atomic_store(&_recording, false); if (!atomic_load(&_playing) && _unit) AudioOutputUnitStop(_unit); return YES; }
- (BOOL)stopPlayout {
  atomic_store(&_playing, false);
  if (_producer) { dispatch_source_cancel(_producer); _producer = nil; dispatch_sync(_producerQueue, ^{}); }
  if (!atomic_load(&_recording) && _unit) AudioOutputUnitStop(_unit);
  [_lock lock]; _head = 0; _count = 0; [_lock unlock]; return YES;
}
- (BOOL)terminateDevice {
  [self stopRecording]; [self stopPlayout];
  if (_unit) { AudioUnitUninitialize(_unit); AudioComponentInstanceDispose(_unit); _unit = NULL; }
  _delegate = nil; _initialized = NO; _recordInitialized = NO; _playoutInitialized = NO; return YES;
}
@end
