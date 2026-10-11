#import <Foundation/Foundation.h>
#import <WebRTC/RTCAudioDevice.h>

NS_ASSUME_NONNULL_BEGIN
FOUNDATION_EXPORT NSNotificationName const SOVoiceInterrupted;
FOUNDATION_EXPORT NSNotificationName const SOVoiceBufferError;
@interface SOVoiceAudioDevice : NSObject <RTCAudioDevice>
+ (instancetype)shared;
- (BOOL)beginCall:(NSError **)error;
- (void)pause;
- (BOOL)resume:(NSError **)error;
- (void)endCall;
@end
NS_ASSUME_NONNULL_END
