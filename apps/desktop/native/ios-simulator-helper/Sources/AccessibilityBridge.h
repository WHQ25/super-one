#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/**
 * The guest's semantic accessibility tree, read from the host.
 *
 * CoreSimulator already carries an accessibility XPC channel and macOS ships the
 * translator that speaks it, so this needs no guest injection, no WebDriverAgent and
 * no XCTest runner. `spike/a11y-dump.m` is the standalone probe this was built from
 * and documents the failure modes -- every one of which is silent.
 *
 * Frames are reported in guest POINTS, already rotated with the device. Touch input
 * is expressed in framebuffer ratios, and the framebuffer never changes shape, so
 * converting between the two needs the current orientation. That conversion belongs
 * to the caller: this bridge reports what the guest said.
 */
@interface S1AccessibilityBridge : NSObject

/** Whether the private surface this needs is present. Checked before attaching. */
@property(class, nonatomic, readonly) BOOL supported;

- (BOOL)attachToDevice:(id)device error:(NSError **)error NS_SWIFT_NAME(attach(toDevice:));

/**
 * Snapshot the frontmost application's tree.
 *
 * Every node carries a `uid` that stays valid until the next dump, and the reply's
 * `generation` counts dumps. Actions quote both, so a request built against a stale
 * snapshot is rejected instead of landing on whatever now occupies that slot.
 */
- (nullable NSDictionary<NSString *, id> *)dumpTreeWithMaxDepth:(NSInteger)maxDepth
                                                      maxNodes:(NSInteger)maxNodes
                                                         error:(NSError **)error
    NS_SWIFT_NAME(dumpTree(maxDepth:maxNodes:));

/** The frontmost element under a point, in guest points. */
- (nullable NSDictionary<NSString *, id> *)hitTestAtX:(double)x
                                                    y:(double)y
                                                error:(NSError **)error
    NS_SWIFT_NAME(hitTest(x:y:));

/**
 * Drive an element through accessibility rather than through HID.
 *
 * This is the semantic delivery path: it addresses the control directly, so it does
 * not care where the element is drawn, whether an animation is mid-flight, or how
 * the device is rotated. It only works for controls the app actually labelled.
 */
- (BOOL)performAction:(NSString *)action
           generation:(NSInteger)generation
                  uid:(NSInteger)uid
                error:(NSError **)error
    NS_SWIFT_NAME(perform(action:generation:uid:));

/** Replace the focused editable control's current selection with text. */
- (BOOL)insertText:(NSString *)text error:(NSError **)error
    NS_SWIFT_NAME(insert(text:));

@end

NS_ASSUME_NONNULL_END
