#import "OrientationBridge.h"

#import <mach/mach.h>
#import <objc/message.h>

// Rotation is the one control with no Indigo constructor behind it: SimulatorKit
// exports IndigoHIDMessageFor{Button,KeyboardArbitrary,MouseNSEvent,...} and nothing
// for orientation. Simulator.app reaches the guest through the pre-Indigo GSEvent
// channel instead, in -[SimDevice(GSEventsPrivate) gsEventsSendOrientation:].
//
// The layout below is read off that method and its -sendPurpleEvent: helper rather
// than guessed: the sender takes infoSize from message+0x48, copies infoSize + 0x4c
// bytes, and writes msgh_size = (infoSize + 0x6b) & ~3. Verified end to end against
// a booted iPhone 17 Pro on iOS 26.5 -- Safari rotates, the home screen does not,
// because SpringBoard on iPhone is portrait-locked either way.
static const char *const kWorkspacePortName = "PurpleWorkspacePort";

/** GSEventRecord.type. The high bit routes the event to the workspace. */
static const uint32_t kGSEventDeviceOrientationChanged = 50;
static const uint32_t kGSEventWorkspaceFlag = 0x20000;
static const mach_msg_id_t kPurpleMessageID = 123;

static const size_t kEventTypeOffset = 0x18;
static const size_t kInfoSizeOffset = 0x48;
static const size_t kInfoOffset = 0x4c;
static const uint32_t kOrientationInfoSize = 4;

BOOL S1DeviceOrientationFromName(NSString *name, S1DeviceOrientation *orientation) {
  NSDictionary<NSString *, NSNumber *> *values = @{
    @"portrait": @(S1DeviceOrientationPortrait),
    @"portrait-upside-down": @(S1DeviceOrientationPortraitUpsideDown),
    @"landscape-left": @(S1DeviceOrientationLandscapeLeft),
    @"landscape-right": @(S1DeviceOrientationLandscapeRight),
  };
  NSNumber *value = values[name.lowercaseString];
  if (value == nil) return NO;
  if (orientation != NULL) *orientation = value.integerValue;
  return YES;
}

static NSError *S1OrientationError(NSInteger code, NSString *message) {
  return [NSError errorWithDomain:@"app.superone.ios-simulator"
                             code:code
                         userInfo:@{NSLocalizedDescriptionKey: message}];
}

@implementation S1OrientationBridge {
  id _device;
  mach_port_t _port;
}

- (BOOL)attachToDevice:(id)device error:(NSError **)error {
  SEL selector = NSSelectorFromString(@"lookup:error:");
  if (![device respondsToSelector:selector]) {
    if (error) *error = S1OrientationError(10, @"This CoreSimulator cannot look up guest ports.");
    return NO;
  }
  _device = device;
  _port = MACH_PORT_NULL;
  return YES;
}

/**
 * Resolved lazily and cached. The port only exists once the guest workspace is up,
 * so an attach that lands during boot would otherwise pin a failure for the whole
 * session.
 */
- (mach_port_t)resolvePortWithError:(NSError **)error {
  if (_port != MACH_PORT_NULL) return _port;
  if (_device == nil) {
    if (error) *error = S1OrientationError(11, @"Attach before rotating.");
    return MACH_PORT_NULL;
  }
  NSError *lookupError = nil;
  mach_port_t port = ((mach_port_t (*)(id, SEL, id, NSError **))objc_msgSend)(
    _device, NSSelectorFromString(@"lookup:error:"),
    @(kWorkspacePortName), &lookupError);
  if (port == MACH_PORT_NULL || port == MACH_PORT_DEAD) {
    if (error) {
      *error = lookupError ?: S1OrientationError(12, @"The guest workspace port is unavailable.");
    }
    return MACH_PORT_NULL;
  }
  _port = port;
  return _port;
}

- (BOOL)applyOrientation:(S1DeviceOrientation)orientation error:(NSError **)error {
  mach_port_t port = [self resolvePortWithError:error];
  if (port == MACH_PORT_NULL) return NO;

  // Sized to what mach_msg_send is told to send, not to what the record needs:
  // msgh_size runs 28 bytes past the record, and Apple's own sender reads that far
  // past its allocation. Over-allocating keeps the same bytes on the wire without
  // the heap over-read.
  uint32_t messageSize = (kOrientationInfoSize + 0x6b) & ~3u;
  uint8_t buffer[0x80];
  memset(buffer, 0, sizeof buffer);
  mach_msg_header_t *header = (mach_msg_header_t *)buffer;
  header->msgh_bits = MACH_MSGH_BITS(MACH_MSG_TYPE_COPY_SEND, 0);
  header->msgh_size = messageSize;
  header->msgh_remote_port = port;
  header->msgh_local_port = MACH_PORT_NULL;
  header->msgh_voucher_port = MACH_PORT_NULL;
  header->msgh_id = kPurpleMessageID;
  *(uint32_t *)(buffer + kEventTypeOffset) = kGSEventDeviceOrientationChanged | kGSEventWorkspaceFlag;
  *(uint32_t *)(buffer + kInfoSizeOffset) = kOrientationInfoSize;
  *(uint32_t *)(buffer + kInfoOffset) = (uint32_t)orientation;

  kern_return_t result = mach_msg_send(header);
  if (result == KERN_SUCCESS) return YES;
  // A reboot hands out a new port, so drop the cached one and let the next attempt
  // look it up again rather than failing forever.
  _port = MACH_PORT_NULL;
  if (error) {
    *error = S1OrientationError(
      13, [NSString stringWithFormat:@"Rotation was rejected (%s).", mach_error_string(result)]);
  }
  return NO;
}

@end
