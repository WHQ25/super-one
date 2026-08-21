/**
 * Standalone probe: dump a booted simulator's semantic accessibility tree.
 *
 * This is the blueprint AccessibilityBridge.{h,m} is built from, kept as a
 * separate binary so the private-framework surface can be re-verified against a
 * new Xcode without rebuilding the helper or launching the app. It lives outside
 * `Sources/` deliberately: the helper's build cache keys on
 * `build.sh` plus everything under `Sources/`, so nothing here can trigger a rebuild.
 *
 *   clang -fobjc-arc -framework Foundation -framework AppKit \
 *     -o /tmp/a11y-dump a11y-dump.m && /tmp/a11y-dump <udid> [--json]
 *
 * Reaching the guest needs no injection, no WebDriverAgent and no XCTest runner.
 * CoreSimulator already carries an accessibility XPC channel, and macOS ships the
 * translator that speaks it:
 *
 *   1. SimDevice -accessibilityPlatformTranslationToken            (the token, == UDID)
 *   2. our AXPTranslationTokenDelegateHelper hands AXPTranslator a per-token block
 *   3. that block forwards AXPTranslatorRequests through
 *      -[SimDevice sendAccessibilityRequestAsync:completionQueue:completionHandler:]
 *   4. -[AXPTranslator frontmostApplicationWithDisplayId:bridgeDelegateToken:]
 *   5. -macPlatformElementFromTranslation: yields an NSAccessibilityElement subclass,
 *      so the tree is then walked with plain AX API and no private enum is needed.
 *
 * Five ways this fails silently -- each one cost a debugging round, so they are
 * all commented at their site below.
 */

#import <AppKit/AppKit.h>
#import <Foundation/Foundation.h>
#import <dlfcn.h>
#import <objc/message.h>
#import <objc/runtime.h>

static id gDevice = nil;

/** Depth and node ceilings, so a runaway tree cannot hang the probe. */
static const int kMaxDepth = 12;
static const int kMaxNodes = 400;

#pragma mark - Bridge delegate

/**
 * AXPTranslator asks this object for a callback per bridge token, then drives every
 * request through it. `AXPTranslationTokenDelegateHelper` declares exactly these
 * three selectors -- SimulatorKit's own SimAccessibilityManager implements the same
 * set, which is how Simulator.app reaches the guest for VoiceOver.
 */
@interface S1AccessibilityBridgeDelegate : NSObject
@end

@implementation S1AccessibilityBridgeDelegate

- (id)accessibilityTranslationDelegateBridgeCallbackWithToken:(id)token {
  return [^id(id request) {
    __block id response = nil;
    dispatch_semaphore_t done = dispatch_semaphore_create(0);
    // FOOTGUN 1: declare the completion handler with a SINGLE parameter. The real
    // arity is not in the type encoding (@? tells us nothing), and a block declared
    // wider than what CoreSimulator calls reads a garbage register.
    void (^handler)(id) = ^(id result) {
      response = result;
      dispatch_semaphore_signal(done);
    };
    ((void (*)(id, SEL, id, dispatch_queue_t, id))objc_msgSend)(
        gDevice, NSSelectorFromString(@"sendAccessibilityRequestAsync:completionQueue:completionHandler:"),
        request, dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), handler);
    if (dispatch_semaphore_wait(done, dispatch_time(DISPATCH_TIME_NOW, 5 * NSEC_PER_SEC)) != 0) {
      fprintf(stderr, "accessibility request timed out\n");
      return (id)nil;
    }
    return response;
  } copy];
}

/** Guest points are reported as-is; the caller owns the rotation math. */
- (CGRect)accessibilityTranslationConvertPlatformFrameToSystem:(CGRect)frame withToken:(id)token {
  return frame;
}

- (id)accessibilityTranslationRootParentWithToken:(id)token { return nil; }

@end

#pragma mark - Attribute helpers

static id axValue(id element, NSString *attribute) {
  return ((id (*)(id, SEL, id))objc_msgSend)(
      element, NSSelectorFromString(@"accessibilityAttributeValue:"), attribute);
}

static NSString *axString(id element, NSString *attribute) {
  id value = axValue(element, attribute);
  if (!value) return nil;
  return [value isKindOfClass:NSString.class] ? value : [value description];
}

static NSDictionary *nodeFromElement(id element, int depth, int *budget) {
  if (!element || depth > kMaxDepth || *budget <= 0) return nil;
  (*budget)--;

  NSMutableDictionary *node = [NSMutableDictionary dictionary];
  for (NSString *key in @[ @"AXRole", @"AXSubrole", @"AXIdentifier", @"AXValue", @"AXHelp" ]) {
    NSString *value = axString(element, key);
    if (value.length) node[[key substringFromIndex:2].lowercaseString] = value;
  }
  NSString *label = [element respondsToSelector:@selector(accessibilityLabel)]
                        ? [element accessibilityLabel]
                        : axString(element, @"AXDescription");
  if (label.length) node[@"label"] = label;

  if ([element respondsToSelector:@selector(accessibilityFrame)]) {
    NSRect frame = [element accessibilityFrame];
    // Guest POINTS (an iPhone 17 Pro Max reports 440x956), already rotated with the
    // device. The framebuffer never changes shape, so converting these into touch
    // ratios needs the orientation -- that math belongs in main, not here.
    node[@"frame"] = @[ @(frame.origin.x), @(frame.origin.y), @(frame.size.width), @(frame.size.height) ];
  }
  id enabled = axValue(element, @"AXEnabled");
  if (enabled) node[@"enabled"] = @([enabled boolValue]);

  NSMutableArray *children = [NSMutableArray array];
  for (id child in axValue(element, @"AXChildren")) {
    NSDictionary *sub = nodeFromElement(child, depth + 1, budget);
    if (sub) [children addObject:sub];
  }
  if (children.count) node[@"children"] = children;
  return node;
}

static void printTree(NSDictionary *node, int depth) {
  NSArray *frame = node[@"frame"];
  for (int i = 0; i < depth; i++) printf("  ");
  printf("%-14s %-28s %s",
         [node[@"role"] ?: @"-" UTF8String],
         [node[@"label"] ?: @"-" UTF8String],
         [node[@"identifier"] ? [@"#" stringByAppendingString:node[@"identifier"]] : @"" UTF8String]);
  if (frame.count == 4) {
    printf("  (%.0f,%.0f %.0fx%.0f)", [frame[0] doubleValue], [frame[1] doubleValue],
           [frame[2] doubleValue], [frame[3] doubleValue]);
  }
  if (node[@"value"]) printf("  = %s", [node[@"value"] UTF8String]);
  printf("\n");
  for (NSDictionary *child in node[@"children"]) printTree(child, depth + 1);
}

#pragma mark - Main

int main(int argc, char **argv) { @autoreleasepool {
  // FOOTGUN 2: unbuffered, or a segfault swallows every line already printed and the
  // probe looks like it never ran at all.
  setvbuf(stdout, NULL, _IONBF, 0);

  if (argc < 2) {
    fprintf(stderr, "usage: a11y-dump <udid> [--json]\n");
    return 2;
  }
  NSString *udid = @(argv[1]);
  BOOL asJson = argc > 2 && strcmp(argv[2], "--json") == 0;

  if (!dlopen("/Library/Developer/PrivateFrameworks/CoreSimulator.framework/CoreSimulator", RTLD_NOW)) {
    fprintf(stderr, "CoreSimulator: %s\n", dlerror());
    return 1;
  }
  if (!dlopen("/System/Library/PrivateFrameworks/AccessibilityPlatformTranslation.framework/"
              "AccessibilityPlatformTranslation", RTLD_NOW)) {
    fprintf(stderr, "AccessibilityPlatformTranslation: %s\n", dlerror());
    return 1;
  }

  NSError *error = nil;
  Class contextClass = NSClassFromString(@"SimServiceContext");
  id context = ((id (*)(id, SEL, id, NSError **))objc_msgSend)(
      contextClass, NSSelectorFromString(@"sharedServiceContextForDeveloperDir:error:"),
      @"/Applications/Xcode.app/Contents/Developer", &error);
  if (!context) { fprintf(stderr, "no service context: %s\n", error.description.UTF8String); return 1; }
  id deviceSet = ((id (*)(id, SEL, NSError **))objc_msgSend)(
      context, NSSelectorFromString(@"defaultDeviceSetWithError:"), &error);
  if (!deviceSet) { fprintf(stderr, "no device set: %s\n", error.description.UTF8String); return 1; }

  for (id candidate in ((id (*)(id, SEL))objc_msgSend)(deviceSet, NSSelectorFromString(@"devices"))) {
    id candidateUdid = ((id (*)(id, SEL))objc_msgSend)(candidate, NSSelectorFromString(@"UDID"));
    if ([[candidateUdid description] caseInsensitiveCompare:udid] == NSOrderedSame) {
      gDevice = candidate;
      break;
    }
  }
  if (!gDevice) { fprintf(stderr, "device %s not found\n", udid.UTF8String); return 1; }

  id token = ((id (*)(id, SEL))objc_msgSend)(
      gDevice, NSSelectorFromString(@"accessibilityPlatformTranslationToken"));
  if (!token) { fprintf(stderr, "no translation token -- is the device booted?\n"); return 1; }

  // FOOTGUN 3: nothing retains the delegate, and ARC will release it the instant the
  // setter returns, leaving the translator on a dangling pointer.
  static S1AccessibilityBridgeDelegate *delegate = nil;
  delegate = [S1AccessibilityBridgeDelegate new];
  CFRetain((__bridge CFTypeRef)delegate);

  // FOOTGUN 4: there are THREE translator singletons and the mac platform elements
  // read a different one than the iOS translator that answers guest requests.
  // Enabling only the iOS instance makes every single attribute return nil -- with no
  // error, no crash, and a complete-looking attribute-name list. Configure all three.
  // FOOTGUN 5: the three selectors go on bridgeTokenDelegate. Setting only
  // bridgeDelegate segfaults inside -[AXPTranslator sendTranslatorRequest:] at 0x10.
  Class translatorClass = NSClassFromString(@"AXPTranslator");
  for (NSString *accessor in @[ @"sharediOSInstance", @"sharedmacOSInstance", @"sharedInstance" ]) {
    id translator = ((id (*)(id, SEL))objc_msgSend)(translatorClass, NSSelectorFromString(accessor));
    if (!translator) continue;
    ((void (*)(id, SEL, id))objc_msgSend)(translator, NSSelectorFromString(@"setBridgeTokenDelegate:"), delegate);
    ((void (*)(id, SEL, id))objc_msgSend)(translator, NSSelectorFromString(@"setBridgeDelegate:"), delegate);
    ((void (*)(id, SEL, BOOL))objc_msgSend)(translator, NSSelectorFromString(@"setSupportsDelegateTokens:"), YES);
    ((void (*)(id, SEL, BOOL))objc_msgSend)(translator, NSSelectorFromString(@"setAccessibilityEnabled:"), YES);
  }

  id translator = ((id (*)(id, SEL))objc_msgSend)(translatorClass, NSSelectorFromString(@"sharediOSInstance"));
  id application = ((id (*)(id, SEL, unsigned int, id))objc_msgSend)(
      translator, NSSelectorFromString(@"frontmostApplicationWithDisplayId:bridgeDelegateToken:"), 0, token);
  if (!application) { fprintf(stderr, "no frontmost application\n"); return 1; }

  // Must be the mac variant: platformElementFromTranslation: returns nil on a macOS host.
  id element = ((id (*)(id, SEL, id))objc_msgSend)(
      translator, NSSelectorFromString(@"macPlatformElementFromTranslation:"), application);
  if (!element) { fprintf(stderr, "no platform element\n"); return 1; }

  int budget = kMaxNodes;
  NSDictionary *tree = nodeFromElement(element, 0, &budget);
  if (!tree) { fprintf(stderr, "empty tree\n"); return 1; }

  if (asJson) {
    NSData *json = [NSJSONSerialization dataWithJSONObject:tree
                                                   options:NSJSONWritingPrettyPrinted
                                                     error:&error];
    if (!json) { fprintf(stderr, "json: %s\n", error.description.UTF8String); return 1; }
    fwrite(json.bytes, 1, json.length, stdout);
    printf("\n");
  } else {
    printTree(tree, 0);
    printf("\n%d nodes\n", kMaxNodes - budget);
  }
  return 0;
} }
