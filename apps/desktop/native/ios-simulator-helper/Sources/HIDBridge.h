#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

typedef NS_ENUM(NSInteger, S1HardwareButton) {
  S1HardwareButtonHome,
  S1HardwareButtonLock,
  S1HardwareButtonSide,
  S1HardwareButtonVolumeUp,
  S1HardwareButtonVolumeDown,
};

typedef NS_ENUM(NSInteger, S1TouchPhase) {
  S1TouchPhaseBegan,
  S1TouchPhaseMoved,
  S1TouchPhaseEnded,
  S1TouchPhaseCancelled,
};

BOOL S1HardwareButtonFromName(NSString *name, S1HardwareButton *button);

@interface S1HIDBridge : NSObject

@property(nonatomic, readonly) NSInteger failedEventCount;
/** Which guard rejected the last event — every failure site has its own tag. */
@property(nonatomic, readonly, copy) NSString *lastFailureReason;

- (BOOL)attachToDevice:(id)device error:(NSError **)error
    NS_SWIFT_NAME(attach(toDevice:));
- (void)tapAtX:(double)x y:(double)y holdMs:(NSInteger)holdMs
    NS_SWIFT_NAME(tap(x:y:holdMs:));
- (void)updateTouches:(NSArray<NSDictionary<NSString *, NSNumber *> *> *)contacts
    NS_SWIFT_NAME(updateTouches(_:));
- (void)cancelTouch NS_SWIFT_NAME(cancelTouch());
- (void)dragFromX:(double)startX y:(double)startY toX:(double)endX endY:(double)endY
    durationMs:(NSInteger)durationMs
    NS_SWIFT_NAME(drag(startX:startY:endX:endY:durationMs:));
- (NSInteger)typeText:(NSString *)text NS_SWIFT_NAME(type(text:));
- (void)tapButton:(S1HardwareButton)button NS_SWIFT_NAME(tapButton(_:));

/**
 * Plugs the simulated hardware keyboard in, or pulls it out.
 *
 * This is the only lever there is over the guest's ON-SCREEN keyboard: iOS shows it
 * whenever a field has focus and no hardware keyboard is attached, so "pop the
 * keyboard up" means "unplug this one". It is also what Simulator.app's Connect
 * Hardware Keyboard does. Pulled out, the key events this bridge sends stop landing
 * -- they ARE the hardware keyboard -- and the user taps the glass instead.
 */
- (BOOL)setHardwareKeyboardConnected:(BOOL)connected error:(NSError **)error
    NS_SWIFT_NAME(setHardwareKeyboardConnected(_:));

@end

NS_ASSUME_NONNULL_END
