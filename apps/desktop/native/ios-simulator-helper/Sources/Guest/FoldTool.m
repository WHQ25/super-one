// Runs INSIDE the simulator (`simctl spawn`), built against the iphonesimulator SDK.
//
// A foldable's posture is not a host-side display switch: SpringBoard picks the panel
// from the hinge angle, so powering a screen off only blanks it. The guest's own
// display tool service is what moves the hinge, and it is the same one Apple's
// internal fold tooling drives. Authorisation is an entitlement, which a simulator
// binary carries in its `__TEXT,__entitlements` section (see FoldTool.entitlements);
// claiming it in the code signature is refused at spawn.
//
// Usage: superone-ios-fold <position 0...1> <seconds> [hold]
//   position  absolute hinge position: 0 closed, 0.5 is 90 degrees, 1 fully open
//   seconds   sweep duration. Must be > 0: a zero duration takes SpringBoard's
//             instant path, which cannot pull content off a fully closed device.
//   hold      portrait, portrait-upside-down, landscape-left or landscape-right: how
//             the device is held when the sweep lands. Omitted, the sweep keeps the
//             pose's orientation, whatever an earlier pose left there.
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
//
// Usage: superone-ios-fold laptop [portrait|portrait-upside-down|landscape-left|landscape-right]
//   Lays a half-open device on its side as a laptop: one half flat, the hinge across
//   the inner panel, held the way named (landscape-right by default). SpringBoard keeps
//   the inner panel lit, so unlike the tent this is no panel swap and is safe from any
//   open angle, and from a laptop already lying another way; apps lay out for the
//   panel turned upright. Like the tent it follows the sweep, which resets it.
//
// Usage: superone-ios-fold turn <hold> <closed|open>
//   Turns a device in neither pose the way named. A sweep leaves a pose override in
//   place, and from then on SpringBoard takes the orientation from it alone: the
//   host's rotation events, and even SpringBoard's own `setDeviceOrientation:`, no
//   longer turn anything. So the turn writes a new override. Its hinge state is the
//   host's to say: a sweep leaves it open even when closed, which SpringBoard only acts
//   on once an override is written, lighting the inner panel of a closed device. A
//   device never swept has no override, which this leaves alone: rotation events still
//   reach it, and an override with no hinge state blanks the display.

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

// Each way the host can hold the device. UIDeviceOrientation, CMDeviceOrientation and
// the sweep's orientation all number them 1 portrait ... 4 landscape right; a laptop's
// CMTabletopPose lists PartiallyOpenPortrait (3), PortraitUpsideDown, LandscapeLeft and
// LandscapeRight (6) in the same order. So all of them follow the host's name.
static const struct { const char *name; long long hold; int tabletop; } kHolds[] = {
  { "portrait", 1, 3 },
  { "portrait-upside-down", 2, 4 },
  { "landscape-left", 3, 5 },
  { "landscape-right", 4, 6 },
};

static BOOL holdNamed(const char *name, long long *hold, int *tabletop) {
  for (size_t i = 0; i < sizeof(kHolds) / sizeof(kHolds[0]); i++) {
    if (strcmp(kHolds[i].name, name) != 0) continue;
    *hold = kHolds[i].hold;
    if (tabletop) *tabletop = kHolds[i].tabletop;
    return YES;
  }
  fprintf(stderr, "a device is held portrait, portrait-upside-down, landscape-left or landscape-right\n");
  return NO;
}

static const int kPoseReadAttempts = 40;
static const useconds_t kPoseReadIntervalMicros = 50000;

static S1DevicePose readPose(id service) {
  return ((S1DevicePose (*)(id, SEL))objc_msgSend)(service, NSSelectorFromString(@"getDevicePose"));
}

/** Calls `body` with the pose service, which asserts if released without being invalidated. */
static int withPoseService(int (^body)(id service)) {
  Class serviceClass = NSClassFromString(@"SBSTestAutomationService");
  if (!serviceClass || ![serviceClass instancesRespondToSelector:NSSelectorFromString(@"setDevicePoseOverride:")]) {
    fprintf(stderr, "this runtime has no pose override\n");
    return 69;
  }
  id service = [[serviceClass alloc] init];
  int status = body(service);
  SEL invalidate = NSSelectorFromString(@"invalidate");
  if ([service respondsToSelector:invalidate]) ((void (*)(id, SEL))objc_msgSend)(service, invalidate);
  return status;
}

static int standWith(id service, S1DevicePose target) {
  ((void (*)(id, SEL, S1DevicePose))objc_msgSend)(service, NSSelectorFromString(@"setDevicePoseOverride:"), target);
  // SpringBoard applies the override on its own queue, so the pose is read back until
  // it shows, for as long as a swap takes, rather than once.
  S1DevicePose pose = {0};
  for (int attempt = 0; attempt < kPoseReadAttempts; attempt++) {
    pose = readPose(service);
    if (pose.cmTabletopPose == target.cmTabletopPose && pose.cmDeviceOrientation == target.cmDeviceOrientation) break;
    usleep(kPoseReadIntervalMicros);
  }
  if (pose.cmTabletopPose != target.cmTabletopPose || pose.cmDeviceOrientation != target.cmDeviceOrientation) {
    fprintf(stderr, "SpringBoard kept tabletop pose %d held %d\n", pose.cmTabletopPose, pose.cmDeviceOrientation);
    return 70;
  }
  return 0;
}

static int stand(S1DevicePose target) {
  return withPoseService(^int(id service) { return standWith(service, target); });
}

static int turn(long long hold, BOOL closed) {
  return withPoseService(^int(id service) {
    if (readPose(service).cmHingeState == 0) return 0;
    return standWith(service, (S1DevicePose){
      .orientation = hold,
      .cmDeviceOrientation = (int)hold,
      .cmHingeState = closed ? 1 : 3,  // Closed, Open
      .cmTabletopPose = 0,
    });
  });
}

int main(int argc, char **argv) {
  @autoreleasepool {
    if (!dlopen("/System/Library/PrivateFrameworks/SpringBoardServices.framework/SpringBoardServices",
                RTLD_NOW)) {
      fprintf(stderr, "SpringBoardServices is unavailable\n");
      return 69;
    }
    if (argc == 2 && strcmp(argv[1], "tent") == 0) return stand(kTentPose);
    if ((argc == 2 || argc == 3) && strcmp(argv[1], "laptop") == 0) {
      long long hold;
      int tabletop;
      if (!holdNamed(argc == 3 ? argv[2] : "landscape-right", &hold, &tabletop)) return 64;
      return stand((S1DevicePose){
        .orientation = hold,
        .cmDeviceOrientation = (int)hold,
        .cmHingeState = 2,  // PartiallyOpen
        .cmTabletopPose = tabletop,
      });
    }
    if (argc == 4 && strcmp(argv[1], "turn") == 0) {
      long long hold;
      if (!holdNamed(argv[2], &hold, NULL)) return 64;
      if (strcmp(argv[3], "closed") != 0 && strcmp(argv[3], "open") != 0) {
        fprintf(stderr, "a turned device is closed or open\n");
        return 64;
      }
      return turn(hold, strcmp(argv[3], "closed") == 0);
    }
    long long hold = 0;
    if (argc != 3 && !(argc == 4 && holdNamed(argv[3], &hold, NULL))) {
      fprintf(stderr, "usage: superone-ios-fold <position 0...1> <seconds> [hold] | superone-ios-fold tent | superone-ios-fold laptop [hold] | superone-ios-fold turn <hold> <closed|open>\n");
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
      .deviceOrientation = hold,
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
