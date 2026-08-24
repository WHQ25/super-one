#import "HIDBridge.h"

#import <CoreGraphics/CoreGraphics.h>
#import <dlfcn.h>
#import <math.h>
#import <objc/message.h>
#import <objc/runtime.h>
#import <stdatomic.h>
#import <time.h>

#pragma pack(push, 4)
typedef struct { unsigned int bits, size, remote, local, voucher, identifier; } S1MachHeader;
typedef struct {
  unsigned int field1, field2, field3;
  double x, y, field6, field7, field8;
  unsigned int field9, field10, field11, field12, field13;
  double field14, field15, field16, field17, field18;
} S1TouchEvent;
typedef struct { unsigned int source, type, target, keyCode, field5; } S1ButtonEvent;
typedef union { S1TouchEvent touch; S1ButtonEvent button; unsigned char raw[144]; } S1Event;
typedef struct { unsigned int field1; unsigned long long timestamp; unsigned int field3; S1Event event; } S1Payload;
typedef struct { S1MachHeader header; unsigned int innerSize; unsigned char eventType; S1Payload payload; } S1Message;
#pragma pack(pop)

typedef S1Message *(*S1ButtonFunction)(int, int, int);
typedef S1Message *(*S1KeyboardFunction)(uint32_t, int);
typedef S1Message *(*S1MouseFunction)(CGPoint *, CGPoint *, double, double, int, int, BOOL);
typedef S1Message *(*S1ArbitraryFunction)(int, uint32_t, uint32_t, int);
// Which layout the guest should believe is plugged in. Simulator.app reads it the
// same way and masks it to a byte before handing it over.
typedef int (*S1KeyboardTypeFunction)(void);

static const int kDown = 1;
static const int kUp = 2;
static const int kDragged = 6;
static const int kHardwareTarget = 0x33;
static const int kTouchTarget = 0x32;
static const uint32_t kConsumerPage = 0x0c;
// SimulatorKit rate-limits motion inside IndigoHIDMessageForMouseNSEvent. It keeps
// a process-global watermark of when it last built ANY message and, for a dragged
// event type, returns NULL unless more than 15,999,999ns have elapsed; down and up
// types set a flag bit that skips the check, which is why only motion ever failed.
// Measured against Xcode's SimulatorKit: a tight loop builds 0 of 200, an 8ms
// cadence builds exactly every other call, and 16ms builds all 200.
//
// Retrying is useless -- the retry recomputes the same delta against the same
// watermark. Mirror the watermark instead and hold the newest snapshot until the
// window opens. Oversampling and letting the gate drop the excess is not equivalent:
// cadences that do not divide evenly alias into ragged spacing (14ms measured 82%
// built with gaps swinging between 16 and 32ms), and irregular motion timing is what
// iOS turns into stuttering scroll velocity.
static const uint64_t kDragGateNanos = 16 * NSEC_PER_MSEC;

// The gate compares mach_absolute_time() converted to nanoseconds, which is exactly
// what CLOCK_UPTIME_RAW reports.
static uint64_t S1MonotonicNanos(void) { return clock_gettime_nsec_np(CLOCK_UPTIME_RAW); }

BOOL S1HardwareButtonFromName(NSString *name, S1HardwareButton *button) {
  NSDictionary *buttons = @{
    @"home": @(S1HardwareButtonHome), @"lock": @(S1HardwareButtonLock),
    @"side": @(S1HardwareButtonSide), @"volume-up": @(S1HardwareButtonVolumeUp),
    @"volume-down": @(S1HardwareButtonVolumeDown),
  };
  NSNumber *value = buttons[name.lowercaseString];
  if (value == nil) return NO;
  if (button != NULL) *button = value.integerValue;
  return YES;
}

static uint32_t S1CharacterUsage(unichar character, BOOL *shifted) {
  BOOL shift = NO;
  uint32_t usage = 0;
  if (character >= 'a' && character <= 'z') usage = 4 + character - 'a';
  else if (character >= 'A' && character <= 'Z') { usage = 4 + character - 'A'; shift = YES; }
  else if (character >= '1' && character <= '9') usage = 30 + character - '1';
  else if (character == '0') usage = 39;
  else {
    switch (character) {
      case '\n': case '\r': usage = 40; break;
      case '\b': case 0x7f: usage = 42; break;
      case '\t': usage = 43; break;
      case ' ': usage = 44; break;
      case '-': usage = 45; break; case '_': usage = 45; shift = YES; break;
      case '=': usage = 46; break; case '+': usage = 46; shift = YES; break;
      case '[': usage = 47; break; case '{': usage = 47; shift = YES; break;
      case ']': usage = 48; break; case '}': usage = 48; shift = YES; break;
      case '\\': usage = 49; break; case '|': usage = 49; shift = YES; break;
      case ';': usage = 51; break; case ':': usage = 51; shift = YES; break;
      case '\'': usage = 52; break; case '"': usage = 52; shift = YES; break;
      case '`': usage = 53; break; case '~': usage = 53; shift = YES; break;
      case ',': usage = 54; break; case '<': usage = 54; shift = YES; break;
      case '.': usage = 55; break; case '>': usage = 55; shift = YES; break;
      case '/': usage = 56; break; case '?': usage = 56; shift = YES; break;
      case '!': usage = 30; shift = YES; break; case '@': usage = 31; shift = YES; break;
      case '#': usage = 32; shift = YES; break; case '$': usage = 33; shift = YES; break;
      case '%': usage = 34; shift = YES; break; case '^': usage = 35; shift = YES; break;
      case '&': usage = 36; shift = YES; break; case '*': usage = 37; shift = YES; break;
      case '(': usage = 38; shift = YES; break; case ')': usage = 39; shift = YES; break;
      default: break;
    }
  }
  if (shifted != NULL) *shifted = shift;
  return usage;
}

@implementation S1HIDBridge {
  id _client;
  // Kept past attach because the hardware-keyboard switch is a SimDevice call, not
  // an Indigo message -- it never goes near _client.
  id _device;
  S1KeyboardTypeFunction _keyboardType;
  dispatch_queue_t _completionQueue;
  S1ButtonFunction _button;
  S1KeyboardFunction _keyboard;
  S1MouseFunction _mouse;
  S1ArbitraryFunction _arbitrary;
  NSInteger _failed;
  NSString *_lastFailure;
  NSInteger _touchIdentifiers[2];
  CGPoint _touchPoints[2];
  BOOL _touchAssigned[2];
  BOOL _touchActive[2];
  dispatch_queue_t _touchQueue;
  _Atomic uint64_t _lastBuildNanos;
  BOOL _dragPending;
  BOOL _dragFlushScheduled;
}

- (instancetype)init {
  self = [super init];
  // Every call into SimulatorKit's message constructors runs here. They share
  // process globals -- the build watermark, the second-contact latch -- and are not
  // reentrant, so the deferred motion flush must not overlap a tap, a keystroke or a
  // hardware button arriving on the control thread.
  if (self) _touchQueue = dispatch_queue_create("app.superone.ios-simulator.touch", DISPATCH_QUEUE_SERIAL);
  return self;
}

- (NSInteger)failedEventCount { @synchronized(self) { return _failed; } }
- (NSString *)lastFailureReason { @synchronized(self) { return _lastFailure ?: @"unknown"; } }
- (void)recordFailure:(NSString *)reason {
  @synchronized(self) { _failed += 1; _lastFailure = reason; }
}

- (S1Message *)buildTouchMessageWithFirst:(CGPoint *)first
                                   second:(CGPoint *)second
                                eventType:(int)eventType {
  if (!_mouse) return NULL;
  S1Message *message = _mouse(first, second, 1, 1, kTouchTarget, eventType, NO);
  // Every successful build pushes the watermark, whatever its event type, so an
  // ungated down delays the next drag exactly as much as another drag would.
  if (message) atomic_store_explicit(&_lastBuildNanos, S1MonotonicNanos(), memory_order_relaxed);
  return message;
}

- (uint64_t)nanosUntilDragGateOpens {
  uint64_t last = atomic_load_explicit(&_lastBuildNanos, memory_order_relaxed);
  uint64_t now = S1MonotonicNanos();
  uint64_t elapsed = now > last ? now - last : 0;
  return elapsed >= kDragGateNanos ? 0 : kDragGateNanos - elapsed;
}

- (BOOL)attachToDevice:(id)device error:(NSError **)error {
  NSString *developerDirectory = NSProcessInfo.processInfo.environment[@"SUPERONE_DEVELOPER_DIR"];
  if (developerDirectory.length == 0) developerDirectory = @"/Applications/Xcode.app/Contents/Developer";
  NSArray *paths = @[
    [developerDirectory stringByAppendingPathComponent:@"Library/PrivateFrameworks/SimulatorKit.framework/SimulatorKit"],
    [[developerDirectory stringByDeletingLastPathComponent] stringByAppendingPathComponent:@"SharedFrameworks/SimulatorKit.framework/SimulatorKit"],
  ];
  void *kit = NULL;
  for (NSString *path in paths) { kit = dlopen(path.fileSystemRepresentation, RTLD_NOW); if (kit) break; }
  if (!kit) {
    if (error) *error = [NSError errorWithDomain:@"app.superone.ios-simulator" code:1 userInfo:@{NSLocalizedDescriptionKey: @"SimulatorKit could not be loaded."}];
    return NO;
  }
  _arbitrary = (S1ArbitraryFunction)dlsym(kit, "IndigoHIDMessageForHIDArbitrary");
  _button = (S1ButtonFunction)dlsym(kit, "IndigoHIDMessageForButton");
  _keyboard = (S1KeyboardFunction)dlsym(kit, "IndigoHIDMessageForKeyboardArbitrary");
  _mouse = (S1MouseFunction)dlsym(kit, "IndigoHIDMessageForMouseNSEvent");
  _keyboardType = (S1KeyboardTypeFunction)dlsym(kit, "IndigoHIDGetKeyboardType");
  if (!_arbitrary || !_button || !_keyboard || !_mouse) {
    if (error) *error = [NSError errorWithDomain:@"app.superone.ios-simulator" code:2 userInfo:@{NSLocalizedDescriptionKey: @"Required Indigo HID symbols are missing."}];
    return NO;
  }
  Class clientClass = objc_lookUpClass("_TtC12SimulatorKit24SimDeviceLegacyHIDClient");
  if (!clientClass) clientClass = NSClassFromString(@"SimulatorKit.SimDeviceLegacyHIDClient");
  SEL selector = NSSelectorFromString(@"initWithDevice:error:");
  if (!clientClass || ![clientClass instancesRespondToSelector:selector]) {
    if (error) *error = [NSError errorWithDomain:@"app.superone.ios-simulator" code:3 userInfo:@{NSLocalizedDescriptionKey: @"Simulator HID client is unavailable."}];
    return NO;
  }
  NSError *clientError = nil;
  _client = ((id (*)(id, SEL, id, NSError **))objc_msgSend)([clientClass alloc], selector, device, &clientError);
  if (!_client) {
    if (error) *error = clientError ?: [NSError errorWithDomain:@"app.superone.ios-simulator" code:4 userInfo:@{NSLocalizedDescriptionKey: @"Simulator HID client failed to attach."}];
    return NO;
  }
  _completionQueue = dispatch_queue_create("app.superone.ios-simulator.hid", DISPATCH_QUEUE_SERIAL);
  _device = device;
  return YES;
}

- (BOOL)setHardwareKeyboardConnected:(BOOL)connected error:(NSError **)error {
  // Read off Simulator.app's own call site (0x10001babc), which is a tail call into
  // objc_msgSend with the type masked to a byte and no error out-parameter:
  //   w3 = IndigoHIDGetKeyboardType() & 0xff; x2 = enabled; x4 = 0
  // The receiver is SimDevice, so unlike rotation this needs no hand-built mach
  // message -- CoreSimulator ships the selector and forwards it over its own bridge.
  SEL selector = NSSelectorFromString(@"setHardwareKeyboardEnabled:keyboardType:error:");
  if (_device == nil || !_keyboardType || ![_device respondsToSelector:selector]) {
    if (error) {
      *error = [NSError errorWithDomain:@"app.superone.ios-simulator" code:5 userInfo:@{
        NSLocalizedDescriptionKey: @"This CoreSimulator cannot connect a hardware keyboard.",
      }];
    }
    return NO;
  }
  NSError *deviceError = nil;
  unsigned char keyboardType = (unsigned char)(_keyboardType() & 0xff);
  BOOL ok = ((BOOL (*)(id, SEL, BOOL, unsigned char, NSError **))objc_msgSend)(
    _device, selector, connected, keyboardType, &deviceError);
  if (!ok && error) {
    *error = deviceError ?: [NSError errorWithDomain:@"app.superone.ios-simulator" code:6 userInfo:@{
      NSLocalizedDescriptionKey: @"The guest refused the hardware keyboard change.",
    }];
  }
  return ok;
}

// Ownership of `message` transfers into this method: the send below hands it to
// Indigo with `freeWhenDone:YES`, so every path that does NOT reach the send has to
// free it here or the buffer leaks — once per rejected event, on a touch stream.
- (void)sendMessage:(S1Message *)message {
  if (!message) { [self recordFailure:@"send:no-message"]; return; }
  if (!_client) { free(message); [self recordFailure:@"send:no-client"]; return; }
  SEL selector = NSSelectorFromString(@"sendWithMessage:freeWhenDone:completionQueue:completion:");
  if (![_client respondsToSelector:selector]) { free(message); [self recordFailure:@"send:selector-missing"]; return; }
  void (^completion)(NSError *) = ^(NSError *sendError) { (void)sendError; };
  ((void (*)(id, SEL, S1Message *, BOOL, dispatch_queue_t, void (^)(NSError *)))objc_msgSend)(
    _client, selector, message, YES, _completionQueue, completion);
}

- (void)setPayload:(S1Payload *)payload active:(BOOL)active {
  payload->event.touch.field9 = active ? 1 : 0;
  payload->event.touch.field10 = active ? 1 : 0;
}

// Motion is held until the gate opens; gesture boundaries go out now. Runs on
// _touchQueue.
- (void)scheduleTouchSnapshotWithEventType:(int)eventType coalescable:(BOOL)coalescable {
  uint64_t wait = coalescable && eventType == kDragged ? [self nanosUntilDragGateOpens] : 0;
  if (wait == 0) {
    _dragPending = NO;
    [self sendTouchSnapshotWithEventType:eventType];
    return;
  }
  // Later samples overwrite the touch state in place, so the one armed flush always
  // carries the freshest position and arming a second would only double the rate.
  _dragPending = YES;
  if (_dragFlushScheduled) return;
  _dragFlushScheduled = YES;
  [self armDragFlushAfter:wait];
}

- (void)armDragFlushAfter:(uint64_t)wait {
  __weak S1HIDBridge *weakSelf = self;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)wait), _touchQueue, ^{
    [weakSelf flushPendingDrag];
  });
}

- (void)flushPendingDrag {
  _dragFlushScheduled = NO;
  if (!_dragPending) return;
  uint64_t wait = [self nanosUntilDragGateOpens];
  if (wait > 0) {
    // dispatch_after may fire a hair early; re-arm rather than spend the sample on a
    // build the gate would reject.
    _dragFlushScheduled = YES;
    [self armDragFlushAfter:wait];
    return;
  }
  _dragPending = NO;
  if (!_touchActive[0] && !_touchActive[1]) return;
  [self sendTouchSnapshotWithEventType:kDragged];
}

- (void)sendTouchSnapshotWithEventType:(int)eventType {
  if (!_touchAssigned[0]) { [self recordFailure:@"snapshot:slot0-unassigned"]; return; }
  BOOL anyActive = _touchActive[0] || _touchActive[1];
  CGPoint first = _touchPoints[0];
  CGPoint second = _touchPoints[1];
  S1Message *message = [self buildTouchMessageWithFirst:&first
                                                 second:(_touchAssigned[1] ? &second : NULL)
                                              eventType:eventType];
  // A snapshot lost here is a frame of motion the device never sees.
  if (!message) { [self recordFailure:@"snapshot:event-ctor-null"]; return; }
  size_t stride = sizeof(S1Payload);
  CGPoint rootPoint = _touchActive[0] || !_touchActive[1] ? _touchPoints[0] : _touchPoints[1];
  message->payload.event.touch.x = rootPoint.x;
  message->payload.event.touch.y = rootPoint.y;
  [self setPayload:&message->payload active:anyActive];
  S1Payload *firstPayload = (S1Payload *)((unsigned char *)&message->payload + stride);
  [self setPayload:firstPayload active:_touchActive[0]];
  if (_touchAssigned[1]) {
    S1Payload *secondPayload = (S1Payload *)((unsigned char *)&message->payload + (2 * stride));
    [self setPayload:secondPayload active:_touchActive[1]];
  }
  [self sendMessage:message];
}

- (void)resetTouches {
  for (NSInteger slot = 0; slot < 2; slot += 1) {
    _touchAssigned[slot] = NO;
    _touchActive[slot] = NO;
    _touchIdentifiers[slot] = 0;
    _touchPoints[slot] = CGPointZero;
  }
}

- (void)sendTouchX:(double)x y:(double)y down:(BOOL)down {
  CGPoint point = CGPointMake(x, y);
  S1Message *message = [self buildTouchMessageWithFirst:&point
                                                 second:NULL
                                              eventType:(down ? kDown : kUp)];
  if (!message) { [self recordFailure:@"tap:event-ctor-null"]; return; }
  [self sendMessage:message];
}

- (void)tapAtX:(double)x y:(double)y holdMs:(NSInteger)holdMs {
  dispatch_sync(_touchQueue, ^{
    [self sendTouchX:x y:y down:YES]; usleep((useconds_t)(MAX(holdMs, 1) * 1000)); [self sendTouchX:x y:y down:NO];
  });
}

- (void)updateTouches:(NSArray<NSDictionary<NSString *, NSNumber *> *> *)contacts {
  dispatch_sync(_touchQueue, ^{ [self applyTouches:contacts]; });
}

- (void)applyTouches:(NSArray<NSDictionary<NSString *, NSNumber *> *> *)contacts {
  NSInteger identifiers[2] = { _touchIdentifiers[0], _touchIdentifiers[1] };
  CGPoint points[2] = { _touchPoints[0], _touchPoints[1] };
  BOOL assigned[2] = { _touchAssigned[0], _touchAssigned[1] };
  BOOL active[2] = { _touchActive[0], _touchActive[1] };
  BOOL hasBegan = NO;
  BOOL hasEnded = NO;
  NSMutableSet<NSNumber *> *seen = [NSMutableSet setWithCapacity:contacts.count];

  for (NSDictionary<NSString *, NSNumber *> *contact in contacts) {
    NSNumber *identifierValue = contact[@"id"];
    NSNumber *xValue = contact[@"x"];
    NSNumber *yValue = contact[@"y"];
    NSNumber *phaseValue = contact[@"phase"];
    if (!identifierValue || !xValue || !yValue || !phaseValue || [seen containsObject:identifierValue]) {
      [self recordFailure:@"update:missing-field-or-dup-id"]; return;
    }
    [seen addObject:identifierValue];
    NSInteger identifier = identifierValue.integerValue;
    NSInteger phase = phaseValue.integerValue;
    double x = xValue.doubleValue;
    double y = yValue.doubleValue;
    if (!isfinite(x) || !isfinite(y) || x < 0 || x > 1 || y < 0 || y > 1
        || phase < S1TouchPhaseBegan || phase > S1TouchPhaseCancelled) {
      [self recordFailure:@"update:bad-coords-or-phase"]; return;
    }

    NSInteger slot = -1;
    for (NSInteger candidate = 0; candidate < 2; candidate += 1) {
      if (assigned[candidate] && identifiers[candidate] == identifier) { slot = candidate; break; }
    }
    if (phase == S1TouchPhaseBegan) {
      if (slot >= 0 && active[slot]) { [self recordFailure:@"update:began-on-active-slot"]; return; }
      if (slot < 0) {
        for (NSInteger candidate = 0; candidate < 2; candidate += 1) {
          if (!assigned[candidate] || !active[candidate]) { slot = candidate; break; }
        }
      }
    } else if (slot < 0 || !active[slot]) {
      [self recordFailure:@"update:moved-on-inactive-slot"]; return;
    }
    if (slot < 0) { [self recordFailure:@"update:no-free-slot"]; return; }
    identifiers[slot] = identifier;
    points[slot] = CGPointMake(x, y);
    assigned[slot] = YES;
    active[slot] = phase == S1TouchPhaseBegan || phase == S1TouchPhaseMoved;
    hasBegan = hasBegan || phase == S1TouchPhaseBegan;
    hasEnded = hasEnded || phase == S1TouchPhaseEnded || phase == S1TouchPhaseCancelled;
  }

  for (NSInteger slot = 0; slot < 2; slot += 1) {
    _touchIdentifiers[slot] = identifiers[slot];
    _touchPoints[slot] = points[slot];
    _touchAssigned[slot] = assigned[slot];
    _touchActive[slot] = active[slot];
  }
  BOOL anyActive = _touchActive[0] || _touchActive[1];
  // A lift that leaves the other finger down still reads as a drag, but the slot it
  // vacates is released right below, so that snapshot cannot wait for the gate.
  [self scheduleTouchSnapshotWithEventType:hasBegan ? kDown : anyActive ? kDragged : kUp
                               coalescable:!hasBegan && !hasEnded];

  if (!_touchActive[0] && !_touchActive[1]) [self resetTouches];
  else if (_touchActive[0] && _touchAssigned[1] && !_touchActive[1]) {
    _touchAssigned[1] = NO;
    _touchIdentifiers[1] = 0;
  }
}

- (void)cancelTouch {
  dispatch_sync(_touchQueue, ^{
    _dragPending = NO;
    if (!_touchAssigned[0] && !_touchAssigned[1]) return;
    _touchActive[0] = NO;
    _touchActive[1] = NO;
    [self sendTouchSnapshotWithEventType:kUp];
    [self resetTouches];
  });
}

- (void)dragFromX:(double)startX y:(double)startY toX:(double)endX endY:(double)endY durationMs:(NSInteger)durationMs {
  dispatch_sync(_touchQueue, ^{
    [self performDragFromX:startX y:startY toX:endX endY:endY durationMs:durationMs];
  });
}

- (void)performDragFromX:(double)startX y:(double)startY toX:(double)endX endY:(double)endY durationMs:(NSInteger)durationMs {
  NSInteger duration = MAX(durationMs, 1);
  NSInteger steps = MIN(MAX(duration / 12, 2), 120);
  [self sendTouchX:startX y:startY down:YES];
  for (NSInteger index = 1; index <= steps; index++) {
    double progress = (double)index / (double)steps;
    usleep((duration * 1000) / steps);
    [self sendTouchX:startX + (endX - startX) * progress y:startY + (endY - startY) * progress down:YES];
  }
  [self sendTouchX:endX y:endY down:NO];
}

- (void)sendKey:(uint32_t)usage down:(BOOL)down {
  if (!_keyboard) { [self recordFailure:@"key:no-keyboard"]; return; }
  [self sendMessage:_keyboard(usage, down ? kDown : kUp)];
}

- (NSInteger)typeText:(NSString *)text {
  __block NSInteger skipped = 0;
  dispatch_sync(_touchQueue, ^{ skipped = [self performTypeText:text]; });
  return skipped;
}

- (NSInteger)performTypeText:(NSString *)text {
  NSInteger skipped = 0;
  for (NSUInteger index = 0; index < text.length; index++) {
    BOOL shifted = NO;
    uint32_t usage = S1CharacterUsage([text characterAtIndex:index], &shifted);
    if (!usage) { skipped += 1; continue; }
    if (shifted) [self sendKey:225 down:YES];
    [self sendKey:usage down:YES]; usleep(10000); [self sendKey:usage down:NO];
    if (shifted) [self sendKey:225 down:NO];
    usleep(12000);
  }
  return skipped;
}

- (void)tapButton:(S1HardwareButton)button {
  dispatch_sync(_touchQueue, ^{ [self performTapButton:button]; });
}

- (void)performTapButton:(S1HardwareButton)button {
  if (button == S1HardwareButtonVolumeUp || button == S1HardwareButtonVolumeDown) {
    uint32_t usage = button == S1HardwareButtonVolumeUp ? 0xe9 : 0xea;
    [self sendMessage:_arbitrary(kHardwareTarget, kConsumerPage, usage, kDown)];
    usleep(80000);
    [self sendMessage:_arbitrary(kHardwareTarget, kConsumerPage, usage, kUp)];
    return;
  }
  int source = button == S1HardwareButtonHome ? 0 : button == S1HardwareButtonLock ? 1 : 0xbb8;
  [self sendMessage:_button(source, kDown, kHardwareTarget)];
  usleep(80000);
  [self sendMessage:_button(source, kUp, kHardwareTarget)];
}

@end
