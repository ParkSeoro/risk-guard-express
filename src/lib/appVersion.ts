/**
 * Phone install version baked into the next Play AAB.
 * package.json version and androidVersionCode must match. The AAB workflow reads those.
 * PC installer version stays separate.
 */
export const APP_VERSION = "1.1.9";

/** Play versionCode. Higher than 478, which is the build already on Play. */
export const ANDROID_VERSION_CODE = 479;
