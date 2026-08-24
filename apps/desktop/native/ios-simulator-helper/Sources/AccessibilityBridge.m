#import "AccessibilityBridge.h"

#import <AppKit/AppKit.h>
#import <dlfcn.h>
#import <objc/message.h>
#import <objc/runtime.h>

// Reaching the guest's accessibility tree runs through three pieces that already
// exist: CoreSimulator's accessibility XPC channel, the token SimDevice hands out to
// name it, and the macOS-side AXPTranslator that speaks the protocol on both ends.
//
// Every way this goes wrong is silent -- nil attributes, never an error -- so the
// non-obvious steps are commented where they happen. `spike/a11y-dump.m` is the
// standalone probe that established all of this and can re-verify it against a new
// Xcode without rebuilding the helper.

static NSString *const kErrorDomain = @"app.superone.ios-simulator";

/** Attributes worth one round trip per node. Fetched together, not one by one. */
static NSArray<NSString *> *S1NodeAttributes(void) {
  static NSArray<NSString *> *attributes;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    attributes = @[
      @"AXRole", @"AXSubrole", @"AXDescription", @"AXValue",
      @"AXIdentifier", @"AXEnabled", @"AXFocused", @"AXFrame"
    ];
  });
  return attributes;
}

static NSError *S1AccessibilityError(NSInteger code, NSString *message) {
  return [NSError errorWithDomain:kErrorDomain
                             code:code
                         userInfo:@{NSLocalizedDescriptionKey : message}];
}

#pragma mark - Bridge delegate

/**
 * AXPTranslator asks this for one callback per bridge token and then drives every
 * request through it. `AXPTranslationTokenDelegateHelper` declares exactly these
 * three selectors; SimulatorKit's own SimAccessibilityManager implements the same
 * set, which is how Simulator.app reaches the guest for VoiceOver.
 */
@interface S1AccessibilityBridgeDelegate : NSObject
@property(nonatomic, strong, nullable) id device;
@end

@implementation S1AccessibilityBridgeDelegate

- (id)accessibilityTranslationDelegateBridgeCallbackWithToken:(id)token {
  __weak __typeof__(self) weakSelf = self;
  return [^id(id request) {
    id device = weakSelf.device;
    if (!device) return (id)nil;
    __block id response = nil;
    dispatch_semaphore_t done = dispatch_semaphore_create(0);
    // Declared with a SINGLE parameter deliberately. The real arity is not in the
    // type encoding, and a block declared wider than the one CoreSimulator calls
    // reads a garbage register.
    void (^handler)(id) = ^(id result) {
      response = result;
      dispatch_semaphore_signal(done);
    };
    ((void (*)(id, SEL, id, dispatch_queue_t, id))objc_msgSend)(
        device,
        NSSelectorFromString(@"sendAccessibilityRequestAsync:completionQueue:completionHandler:"),
        request, dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), handler);
    // A guest mid-transition can take a moment; a guest that is wedged must not take
    // the helper's control queue down with it.
    if (dispatch_semaphore_wait(done, dispatch_time(DISPATCH_TIME_NOW, 5 * NSEC_PER_SEC)) != 0) {
      return (id)nil;
    }
    return response;
  } copy];
}

/** Guest points are passed through; the caller owns the rotation math. */
- (CGRect)accessibilityTranslationConvertPlatformFrameToSystem:(CGRect)frame withToken:(id)token {
  return frame;
}

- (id)accessibilityTranslationRootParentWithToken:(id)token { return nil; }

@end

#pragma mark - Bridge

@implementation S1AccessibilityBridge {
  id _device;
  id _token;
  S1AccessibilityBridgeDelegate *_delegate;
  /** uid -> platform element for the current generation. Rebuilt by every dump. */
  NSMutableDictionary<NSNumber *, id> *_elements;
  NSInteger _generation;
  NSInteger _nextUid;
}

+ (BOOL)supported {
  Class translator = NSClassFromString(@"AXPTranslator");
  if (!translator) return NO;
  if (![translator respondsToSelector:NSSelectorFromString(@"sharediOSInstance")]) return NO;
  Class device = NSClassFromString(@"SimDevice");
  // Probe the guest channel itself rather than just the translator: a CoreSimulator
  // without it leaves the translator present but with nowhere to send requests.
  return [device instancesRespondToSelector:NSSelectorFromString(
                     @"sendAccessibilityRequestAsync:completionQueue:completionHandler:")]
      && [device instancesRespondToSelector:NSSelectorFromString(
                     @"accessibilityPlatformTranslationToken")];
}

- (instancetype)init {
  if ((self = [super init])) {
    _elements = [NSMutableDictionary dictionary];
  }
  return self;
}

- (BOOL)attachToDevice:(id)device error:(NSError **)error {
  if (!S1AccessibilityBridge.supported) {
    if (error) *error = S1AccessibilityError(20, @"This toolchain cannot translate guest accessibility.");
    return NO;
  }
  id token = ((id (*)(id, SEL))objc_msgSend)(
      device, NSSelectorFromString(@"accessibilityPlatformTranslationToken"));
  if (!token) {
    if (error) *error = S1AccessibilityError(21, @"The guest accessibility channel is unavailable.");
    return NO;
  }

  _device = device;
  _token = token;
  _delegate = [S1AccessibilityBridgeDelegate new];
  _delegate.device = device;
  [_elements removeAllObjects];

  // Three things at once, each of which fails invisibly on its own:
  //
  // 1. The delegate goes on bridgeTokenDelegate. Setting only bridgeDelegate
  //    segfaults inside -[AXPTranslator sendTranslatorRequest:] at 0x10.
  // 2. There are THREE translator singletons, and the mac platform elements read a
  //    different one than the iOS translator that answers guest requests. Enable only
  //    the iOS one and every attribute returns nil -- no error, no crash, and a
  //    complete-looking attribute-name list.
  // 3. The delegate is held in an ivar because the setters do not retain it.
  Class translatorClass = NSClassFromString(@"AXPTranslator");
  for (NSString *accessor in @[ @"sharediOSInstance", @"sharedmacOSInstance", @"sharedInstance" ]) {
    id translator = ((id (*)(id, SEL))objc_msgSend)(translatorClass, NSSelectorFromString(accessor));
    if (!translator) continue;
    ((void (*)(id, SEL, id))objc_msgSend)(
        translator, NSSelectorFromString(@"setBridgeTokenDelegate:"), _delegate);
    ((void (*)(id, SEL, id))objc_msgSend)(
        translator, NSSelectorFromString(@"setBridgeDelegate:"), _delegate);
    ((void (*)(id, SEL, BOOL))objc_msgSend)(
        translator, NSSelectorFromString(@"setSupportsDelegateTokens:"), YES);
    ((void (*)(id, SEL, BOOL))objc_msgSend)(
        translator, NSSelectorFromString(@"setAccessibilityEnabled:"), YES);
  }
  return YES;
}

- (nullable id)translatorWithError:(NSError **)error {
  if (!_device) {
    if (error) *error = S1AccessibilityError(22, @"Attach before reading accessibility.");
    return nil;
  }
  id translator = ((id (*)(id, SEL))objc_msgSend)(
      NSClassFromString(@"AXPTranslator"), NSSelectorFromString(@"sharediOSInstance"));
  if (!translator) {
    if (error) *error = S1AccessibilityError(23, @"The accessibility translator is unavailable.");
  }
  return translator;
}

/** Translation objects are per-request; the mac variant is the only one a host can build. */
- (nullable id)platformElementFor:(id)translation translator:(id)translator {
  if (!translation) return nil;
  return ((id (*)(id, SEL, id))objc_msgSend)(
      translator, NSSelectorFromString(@"macPlatformElementFromTranslation:"), translation);
}

- (nullable id)frontmostApplicationElementWithError:(NSError **)error {
  id translator = [self translatorWithError:error];
  if (!translator) return nil;
  id application = ((id (*)(id, SEL, unsigned int, id))objc_msgSend)(
      translator, NSSelectorFromString(@"frontmostApplicationWithDisplayId:bridgeDelegateToken:"),
      0, _token);
  id element = [self platformElementFor:application translator:translator];
  if (!element && error) {
    *error = S1AccessibilityError(24, @"The guest reported no frontmost application.");
  }
  return element;
}

- (NSMutableDictionary<NSString *, id> *)describeElement:(id)element {
  NSMutableDictionary<NSString *, id> *node = [NSMutableDictionary dictionary];
  // One round trip for the whole attribute set. Asking per attribute costs a guest
  // XPC hop each and turns a routine snapshot into hundreds of them.
  NSDictionary *values = ((id (*)(id, SEL, id))objc_msgSend)(
      element, NSSelectorFromString(@"accessibilityMultipleAttributes:"), S1NodeAttributes());

  NSString *role = values[@"AXRole"];
  if (role.length) node[@"role"] = role;
  NSString *subrole = values[@"AXSubrole"];
  if (subrole.length) node[@"subrole"] = subrole;
  // The root reports a single space rather than nothing, so trim before deciding.
  NSString *label = [values[@"AXDescription"]
      stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
  if (label.length) node[@"label"] = label;
  NSString *identifier = values[@"AXIdentifier"];
  if (identifier.length) node[@"identifier"] = identifier;

  id value = values[@"AXValue"];
  if (value) {
    NSString *text = [value isKindOfClass:NSString.class] ? value : [value description];
    if (text.length) node[@"value"] = text;
  }
  if (values[@"AXEnabled"]) node[@"enabled"] = @([values[@"AXEnabled"] boolValue]);
  if (values[@"AXFocused"]) node[@"focused"] = @([values[@"AXFocused"] boolValue]);

  id frame = values[@"AXFrame"];
  if ([frame isKindOfClass:NSValue.class]) {
    NSRect rect = [frame rectValue];
    // Guest points, already rotated with the device.
    node[@"frame"] = @[ @(rect.origin.x), @(rect.origin.y), @(rect.size.width), @(rect.size.height) ];
  }
  return node;
}

- (nullable NSMutableDictionary<NSString *, id> *)nodeForElement:(id)element
                                                           depth:(NSInteger)depth
                                                        maxDepth:(NSInteger)maxDepth
                                                          budget:(NSInteger *)budget {
  if (!element || depth > maxDepth || *budget <= 0) return nil;
  (*budget)--;

  NSMutableDictionary<NSString *, id> *node = [self describeElement:element];
  NSNumber *uid = @(_nextUid++);
  node[@"uid"] = uid;
  _elements[uid] = element;

  NSArray *children = ((id (*)(id, SEL, id))objc_msgSend)(
      element, NSSelectorFromString(@"accessibilityAttributeValue:"), @"AXChildren");
  if (children.count) {
    NSMutableArray *encoded = [NSMutableArray arrayWithCapacity:children.count];
    for (id child in children) {
      NSDictionary *sub = [self nodeForElement:child depth:depth + 1 maxDepth:maxDepth budget:budget];
      if (sub) [encoded addObject:sub];
    }
    if (encoded.count) node[@"children"] = encoded;
    // Say so when the tree was cut short, or a partial snapshot reads as a complete one.
    if (encoded.count < children.count) node[@"truncatedChildren"] = @(children.count - encoded.count);
  }
  return node;
}

- (nullable NSDictionary<NSString *, id> *)dumpTreeWithMaxDepth:(NSInteger)maxDepth
                                                      maxNodes:(NSInteger)maxNodes
                                                         error:(NSError **)error {
  id element = [self frontmostApplicationElementWithError:error];
  if (!element) return nil;

  // A dump invalidates the previous one wholesale: the uids it handed out named
  // elements that may no longer exist, and reusing them would land actions on
  // whatever now occupies the slot.
  [_elements removeAllObjects];
  _nextUid = 0;
  _generation++;

  NSInteger budget = maxNodes;
  NSMutableDictionary *tree = [self nodeForElement:element depth:0 maxDepth:maxDepth budget:&budget];
  if (!tree) {
    if (error) *error = S1AccessibilityError(25, @"The guest returned an empty tree.");
    return nil;
  }
  return @{
    @"generation" : @(_generation),
    @"nodes" : @(maxNodes - budget),
    @"complete" : @(budget > 0),
    @"tree" : tree,
  };
}

- (nullable NSDictionary<NSString *, id> *)hitTestAtX:(double)x
                                                    y:(double)y
                                                error:(NSError **)error {
  id translator = [self translatorWithError:error];
  if (!translator) return nil;

  id translation = ((id (*)(id, SEL, CGPoint, unsigned int, id))objc_msgSend)(
      translator, NSSelectorFromString(@"objectAtPoint:displayId:bridgeDelegateToken:"),
      CGPointMake(x, y), 0, _token);
  id element = [self platformElementFor:translation translator:translator];
  if (!element) {
    if (error) *error = S1AccessibilityError(26, @"No element at that point.");
    return nil;
  }
  return [self describeElement:element];
}

- (BOOL)performAction:(NSString *)action
           generation:(NSInteger)generation
                  uid:(NSInteger)uid
                error:(NSError **)error {
  if (generation != _generation) {
    if (error) {
      *error = S1AccessibilityError(
          27, [NSString stringWithFormat:@"Snapshot %ld is stale; the tree is now at %ld.",
                                          (long)generation, (long)_generation]);
    }
    return NO;
  }
  id element = _elements[@(uid)];
  if (!element) {
    if (error) *error = S1AccessibilityError(28, @"That element is not in the current snapshot.");
    return NO;
  }

  NSDictionary<NSString *, NSString *> *selectors = @{
    @"press" : @"accessibilityPerformPress",
    @"increment" : @"performIncrementAction",
    @"decrement" : @"performDecrementAction",
    @"escape" : @"performEscapeAction",
    @"magicTap" : @"performMagicTapAction",
  };
  NSString *selectorName = selectors[action];
  if (!selectorName) {
    if (error) {
      *error = S1AccessibilityError(
          29, [NSString stringWithFormat:@"Unknown accessibility action %@.", action]);
    }
    return NO;
  }
  SEL selector = NSSelectorFromString(selectorName);
  if (![element respondsToSelector:selector]) {
    if (error) {
      *error = S1AccessibilityError(
          30, [NSString stringWithFormat:@"This element does not support %@.", action]);
    }
    return NO;
  }
  ((void (*)(id, SEL))objc_msgSend)(element, selector);
  return YES;
}

- (BOOL)insertText:(NSString *)text error:(NSError **)error {
  id application = [self frontmostApplicationElementWithError:error];
  if (!application) return NO;

  id focused = ((id (*)(id, SEL, id))objc_msgSend)(
      application, NSSelectorFromString(@"accessibilityAttributeValue:"), @"AXFocusedUIElement");
  if (!focused) {
    if (error) *error = S1AccessibilityError(31, @"No guest input is focused.");
    return NO;
  }

  BOOL settable = ((BOOL (*)(id, SEL, id))objc_msgSend)(
      focused, NSSelectorFromString(@"accessibilityIsAttributeSettable:"), @"AXSelectedText");
  if (settable) {
    ((void (*)(id, SEL, id, id))objc_msgSend)(
        focused, NSSelectorFromString(@"accessibilitySetValue:forAttribute:"), text, @"AXSelectedText");
    return YES;
  }

  NSDictionary *values = ((id (*)(id, SEL, id))objc_msgSend)(
      focused, NSSelectorFromString(@"accessibilityMultipleAttributes:"),
      @[ @"AXValue", @"AXSelectedTextRange" ]);
  NSString *value = [values[@"AXValue"] isKindOfClass:NSString.class] ? values[@"AXValue"] : nil;
  NSValue *rangeValue = [values[@"AXSelectedTextRange"] isKindOfClass:NSValue.class]
      ? values[@"AXSelectedTextRange"] : nil;
  BOOL valueSettable = ((BOOL (*)(id, SEL, id))objc_msgSend)(
      focused, NSSelectorFromString(@"accessibilityIsAttributeSettable:"), @"AXValue");
  NSRange range = rangeValue.rangeValue;
  if (!value || !rangeValue || !valueSettable || NSMaxRange(range) > value.length) {
    if (error) *error = S1AccessibilityError(32, @"The focused guest control cannot accept text.");
    return NO;
  }
  NSString *updated = [value stringByReplacingCharactersInRange:range withString:text];
  ((void (*)(id, SEL, id, id))objc_msgSend)(
      focused, NSSelectorFromString(@"accessibilitySetValue:forAttribute:"), updated, @"AXValue");
  return YES;
}

@end
