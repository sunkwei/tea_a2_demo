# a2_share 手机端 R8 规则
# ZXing core 有反射（MultiFormatReader / 条码格式注册），保留整个包
-keep class com.google.zxing.** { *; }
-dontwarn com.google.zxing.**
# CameraX 的实现类由反射加载
-keep class androidx.camera.** { *; }
-dontwarn androidx.camera.**
