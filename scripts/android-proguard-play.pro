# SafeNex release R8 — Capacitor plugins use reflection.
# Consumer rules from capacitor-android are not always enough for community plugins.

-keepattributes SourceFile,LineNumberTable,InnerClasses,Signature,*Annotation*

-keep public class * extends com.getcapacitor.Plugin { *; }

-keep @com.getcapacitor.annotation.CapacitorPlugin public class * {
    @com.getcapacitor.annotation.PermissionCallback <methods>;
    @com.getcapacitor.annotation.ActivityCallback <methods>;
    @com.getcapacitor.annotation.Permission <methods>;
    @com.getcapacitor.PluginMethod public <methods>;
}

-keep @com.getcapacitor.NativePlugin public class * {
    @com.getcapacitor.PluginMethod public <methods>;
}

-keep class org.safenex.app.** { *; }
-keep class com.getcapacitor.** { *; }
-keep class com.capacitorjs.** { *; }
-keep class ee.forgr.** { *; }

-dontwarn com.getcapacitor.**
-dontwarn com.capacitorjs.**
