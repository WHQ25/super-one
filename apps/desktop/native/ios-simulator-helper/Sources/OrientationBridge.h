#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/** UIDeviceOrientation, which is the vocabulary the guest workspace accepts. */
typedef NS_ENUM(NSInteger, S1DeviceOrientation) {
  S1DeviceOrientationPortrait = 1,
  S1DeviceOrientationPortraitUpsideDown = 2,
  S1DeviceOrientationLandscapeLeft = 3,
  S1DeviceOrientationLandscapeRight = 4,
};

BOOL S1DeviceOrientationFromName(NSString *name, S1DeviceOrientation *orientation);

/**
 * Rotation, which is the one device control that does NOT go through Indigo HID.
 * SimulatorKit exports no rotation message constructor at all; Simulator.app posts a
 * GSEvent to the guest's workspace mach port instead, and so do we.
 */
@interface S1OrientationBridge : NSObject

- (BOOL)attachToDevice:(id)device error:(NSError **)error
    NS_SWIFT_NAME(attach(toDevice:));
- (BOOL)applyOrientation:(S1DeviceOrientation)orientation error:(NSError **)error
    NS_SWIFT_NAME(apply(_:));

@end

NS_ASSUME_NONNULL_END
