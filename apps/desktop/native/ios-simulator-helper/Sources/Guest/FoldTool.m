// Runs INSIDE the simulator (`simctl spawn`), built against the iphonesimulator SDK.
//
// A foldable's posture is not a host-side display switch: SpringBoard picks the panel
// from the hinge angle, so powering a screen off only blanks it. The guest's own
// display tool service is what moves the hinge, and it is the same one Apple's
// internal fold tooling drives. Authorisation is an entitlement, which a simulator
// binary carries in its `__TEXT,__entitlements` section (see FoldTool.entitlements);
// claiming it in the code signature is refused at spawn.
//
// Usage: superone-ios-fold <position 0...1> <seconds>
//   position  absolute hinge position: 0 closed, 0.5 is 90 degrees, 1 fully open
//   seconds   sweep duration. Must be > 0: a zero duration takes SpringBoard's
//             instant path, which cannot pull content off a fully closed device.
//
// Usage: superone-ios-fold tent
//   Stands a closed device up as a tent: SpringBoard lights the cover at a partial
//   angle once CoreMotion reports the device half open and face down, which only a
//   pose override can say in a simulator; the pose also puts the hinge at 90 degrees.
//   Run it on a CLOSED device. Every sweep resets the pose, so it follows the sweep;
//   and from closed the cover is already primary, so the switch to the tent is not a
//   panel swap. From an open device it is one, styled as a continuous fold that only
//   hinge travel can finish, so it never ends and SpringBoard refuses every later
//   sweep as "a display swap is already in flight".

#import <Foundation/Foundation.h>
#import <dlfcn.h>
#import <unistd.h>
#import <objc/message.h>

// `-[SBSDisplayToolService swapDisplayWithSettings:completionHandler:]` takes this by
// value (type encoding `{?=qdqqBqdd}`). Field meanings come from SpringBoard's own
// request log, which prints duration, orientation, profile override and wait.
typedef struct {
  long long unused0;
  double duration;
  long long deviceOrientation;  // 0 keeps the current orientation
  long long profileOverride;    // 0 uses the selected hinge profile
  BOOL waitForCompletion;
  long long targetMode;         // 1 sweeps to `targetHingePosition`
  double targetHingePosition;
  double unused1;
} S1DisplayToolSwapSettings;

static const long long kTargetModeAbsolutePosition = 1;
static const int64_t kReplyTimeoutSeconds = 15;

// `-[SBSTestAutomationService setDevicePoseOverride:]` takes this by value (type
// encoding `{?=qiii}`). The CoreMotion fields use CMDeviceOrientation, CMHingeState
// and CMTabletopPose; SpringBoard rewrites `orientation` from them.
typedef struct {
  long long orientation;
  int cmDeviceOrientation;
  int cmHingeState;
  int cmTabletopPose;
} S1DevicePose;

static const S1DevicePose kTentPose = {
  .orientation = 4,
  .cmDeviceOrientation = 6,  // FaceDown
  .cmHingeState = 2,         // PartiallyOpen
  .cmTabletopPose = 7,       // PartiallyOpenFaceDown, what SpringBoard's tent policy keys on
};

static const int kPoseReadAttempts = 40;
static const useconds_t kPoseReadIntervalMicros = 50000;

static int standAsTent(void) {
  Class serviceClass = NSClassFromString(@"SBSTestAutomationService");
  SEL setPose = NSSelectorFromString(@"setDevicePoseOverride:");
  if (!serviceClass || ![serviceClass instancesRespondToSelector:setPose]) {
    fprintf(stderr, "this runtime has no pose override\n");
    return 69;
  }
  id service = [[serviceClass alloc] init];
  ((void (*)(id, SEL, S1DevicePose))objc_msgSend)(service, setPose, kTentPose);
  // SpringBoard applies the override on its own queue, so the pose is read back until
  // it shows, for as long as a swap takes, rather than once.
  SEL getPose = NSSelectorFromString(@"getDevicePose");
  S1DevicePose pose = {0};
  for (int attempt = 0; attempt < kPoseReadAttempts; attempt++) {
    pose = ((S1DevicePose (*)(id, SEL))objc_msgSend)(service, getPose);
    if (pose.cmTabletopPose == kTentPose.cmTabletopPose) break;
    usleep(kPoseReadIntervalMicros);
  }
  SEL invalidate = NSSelectorFromString(@"invalidate");
  if ([service respondsToSelector:invalidate]) ((void (*)(id, SEL))objc_msgSend)(service, invalidate);
  if (pose.cmTabletopPose != kTentPose.cmTabletopPose) {
    fprintf(stderr, "SpringBoard kept tabletop pose %d\n", pose.cmTabletopPose);
    return 70;
  }
  return 0;
}

int main(int argc, char **argv) {
  @autoreleasepool {
    if (!dlopen("/System/Library/PrivateFrameworks/SpringBoardServices.framework/SpringBoardServices",
                RTLD_NOW)) {
      fprintf(stderr, "SpringBoardServices is unavailable\n");
      return 69;
    }
    if (argc == 2 && strcmp(argv[1], "tent") == 0) return standAsTent();
    if (argc != 3) {
      fprintf(stderr, "usage: superone-ios-fold <position 0...1> <seconds> | superone-ios-fold tent\n");
      return 64;
    }
    double position = strtod(argv[1], NULL);
    double seconds = strtod(argv[2], NULL);
    if (!(position >= 0 && position <= 1) || !(seconds > 0 && seconds <= 5)) {
      fprintf(stderr, "position must be in 0...1 and seconds in (0, 5]\n");
      return 64;
    }
    Class serviceClass = NSClassFromString(@"SBSDisplayToolService");
    SEL swap = NSSelectorFromString(@"swapDisplayWithSettings:completionHandler:");
    if (!serviceClass || ![serviceClass instancesRespondToSelector:swap]) {
      fprintf(stderr, "this runtime has no display tool service\n");
      return 69;
    }

    id service = [[serviceClass alloc] init];
    S1DisplayToolSwapSettings settings = {
      .duration = seconds,
      .waitForCompletion = YES,
      .targetMode = kTargetModeAbsolutePosition,
      .targetHingePosition = position,
    };
    __block NSError *failure = nil;
    dispatch_semaphore_t done = dispatch_semaphore_create(0);
    void (^completion)(NSError *) = ^(NSError *error) {
      failure = error;
      dispatch_semaphore_signal(done);
    };
    ((void (*)(id, SEL, S1DisplayToolSwapSettings, id))objc_msgSend)(
        service, swap, settings, completion);
    long timedOut = dispatch_semaphore_wait(
        done, dispatch_time(DISPATCH_TIME_NOW, kReplyTimeoutSeconds * NSEC_PER_SEC));
    // The service asserts if it is released without being invalidated.
    ((void (*)(id, SEL))objc_msgSend)(service, NSSelectorFromString(@"invalidate"));

    if (timedOut) {
      fprintf(stderr, "SpringBoard did not answer the fold request\n");
      return 75;
    }
    if (failure) {
      fprintf(stderr, "%s\n", failure.description.UTF8String);
      return 70;
    }
    return 0;
  }
}
