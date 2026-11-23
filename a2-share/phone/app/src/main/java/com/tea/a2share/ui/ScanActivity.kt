package com.tea.a2share.ui

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Bundle
import android.provider.MediaStore
import android.util.Log
import android.view.Gravity
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import com.google.zxing.BarcodeFormat
import com.google.zxing.BinaryBitmap
import com.google.zxing.DecodeHintType
import com.google.zxing.MultiFormatReader
import com.google.zxing.PlanarYUVLuminanceSource
import com.google.zxing.RGBLuminanceSource
import com.google.zxing.common.HybridBinarizer
import com.tea.a2share.App
import com.tea.a2share.R
import com.tea.a2share.core.PairState
import com.tea.a2share.core.QrPayload
import com.tea.a2share.net.ApiException
import com.tea.a2share.svc.TransferService
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withContext
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * 扫码连接 PC（需求 FR-P09 / FR-P10）。
 *
 * 相机扫码（CameraX + ZXing core，纯本地、无 GMS）为主路径；
 * 「输入短码」与「从相册选二维码」是兜底（AC-15）。
 */
class ScanActivity : AppCompatActivity() {

    private lateinit var app: App
    private val analysisExecutor: ExecutorService = Executors.newSingleThreadExecutor()
    private var handling = false

    private val requestCamera = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        if (granted) startCamera() else showHint(getString(R.string.error_no_camera_permission))
    }

    private val pickImage = registerForActivityResult(
        ActivityResultContracts.GetContent()
    ) { uri: Uri? ->
        if (uri != null) decodeFromGallery(uri)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        app = App.instance
        setContentView(buildLayout())
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA)
            == PackageManager.PERMISSION_GRANTED
        ) {
            startCamera()
        } else {
            requestCamera.launch(Manifest.permission.CAMERA)
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        analysisExecutor.shutdown()
    }

    // ---------------------------------------------------------------- 布局
    private fun buildLayout(): android.view.View {
        val root = FrameLayout(this)

        val preview = androidx.camera.view.PreviewView(this).apply {
            layoutParams = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT,
            )
        }
        root.addView(preview)
        cameraPreview = preview

        val panel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(dp(16), dp(16), dp(16), dp(24))
        }
        panel.addView(
            TextView(this).apply {
                setText(R.string.scan_hint)
                textSize = 16f
            },
        )
        panel.addView(
            TextView(this).apply {
                setText(R.string.scan_or_code)
                textSize = 13f
            },
        )
        panel.addView(
            Button(this).apply {
                setText(R.string.action_input_code)
                setOnClickListener { promptShortCode() }
            },
        )
        panel.addView(
            Button(this).apply {
                setText(R.string.action_pick_gallery)
                setOnClickListener { pickImage.launch("image/*") }
            },
        )
        hintText = TextView(this).apply { visibility = android.view.View.GONE }

        val params = FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.WRAP_CONTENT,
            Gravity.BOTTOM,
        )
        root.addView(panel, params)
        root.addView(
            hintText,
            FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.WRAP_CONTENT,
                Gravity.TOP,
            ),
        )
        return root
    }

    private lateinit var cameraPreview: androidx.camera.view.PreviewView
    private lateinit var hintText: TextView

    // ---------------------------------------------------------------- 相机
    private fun startCamera() {
        val providerFuture = ProcessCameraProvider.getInstance(this)
        providerFuture.addListener({
            try {
                val provider = providerFuture.get()
                val preview = Preview.Builder().build().also {
                    it.setSurfaceProvider(cameraPreview.surfaceProvider)
                }
                val analysis = ImageAnalysis.Builder()
                    .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                    .build()
                analysis.setAnalyzer(analysisExecutor) { proxy -> analyze(proxy) }
                provider.unbindAll()
                provider.bindToLifecycle(this, CameraSelector.DEFAULT_BACK_CAMERA, preview, analysis)
            } catch (e: Exception) {
                Log.w("a2share", "相机启动失败", e)
                showHint(getString(R.string.error_no_camera_permission))
            }
        }, ContextCompat.getMainExecutor(this))
    }

    private fun analyze(proxy: ImageProxy) {
        try {
            if (handling) return
            val image = proxy.image
            if (image == null) return
            val plane = image.planes[0]
            val buffer = plane.buffer
            val data = ByteArray(buffer.remaining())
            buffer.get(data)
            val source = PlanarYUVLuminanceSource(
                data,
                plane.rowStride,
                plane.rowStride,
                0, 0,
                image.width,
                image.height,
                false,
            )
            val text = decode(source)
            if (!text.isNullOrEmpty()) {
                handling = true
                runOnUiThread { onPayload(text) }
            }
        } catch (_: Exception) {
            // 单帧失败忽略
        } finally {
            proxy.close()
        }
    }

    private fun decode(source: com.google.zxing.LuminanceSource): String? = try {
        val hints = mapOf(
            DecodeHintType.POSSIBLE_FORMATS to listOf(BarcodeFormat.QR_CODE),
            DecodeHintType.TRY_HARDER to true,
        )
        val reader = MultiFormatReader().apply { setHints(hints) }
        reader.decodeWithState(BinaryBitmap(HybridBinarizer(source))).text
    } catch (_: Exception) {
        null
    }

    private fun decodeFromGallery(uri: Uri) {
        lifecycleScope.launch {
            val bitmap = withContext(Dispatchers.IO) {
                try {
                    contentResolver.openInputStream(uri)?.use {
                        BitmapFactory.decodeStream(it)
                    }
                } catch (_: Exception) {
                    null
                }
            }
            if (bitmap == null) {
                toast(getString(R.string.error_bad_payload))
                return@launch
            }
            val text = decodeBitmap(bitmap)
            if (text.isNullOrEmpty()) {
                toast(getString(R.string.error_bad_payload))
            } else {
                onPayload(text)
            }
        }
    }

    private fun decodeBitmap(bitmap: Bitmap): String? = try {
        val width = bitmap.width
        val height = bitmap.height
        val pixels = IntArray(width * height)
        bitmap.getPixels(pixels, 0, width, 0, 0, width, height)
        val source = RGBLuminanceSource(width, height, pixels)
        decode(source)
    } catch (_: Exception) {
        null
    }

    // ---------------------------------------------------------------- 配对
    private fun onPayload(raw: String) {
        val parsed = QrPayload.decode(raw)
        when (parsed) {
            is QrPayload.QrResult.Failure -> {
                handling = false
                toast(getString(R.string.error_bad_payload))
                return
            }

            is QrPayload.QrResult.Success -> {
                val hint = parsed.hint
                pairWithSecret(hint.secret, "http://${hint.ip}:${hint.port}")
            }
        }
    }

    /** 短码兜底：短码本身不含地址，需要用户补一个「监听地址」（PC 终端会打印）。 */
    private fun promptShortCode() {
        val codeInput = EditText(this).apply {
            hint = getString(R.string.hint_short_code)
            inputType = android.text.InputType.TYPE_CLASS_NUMBER
        }
        val addressInput = EditText(this).apply {
            hint = "PC 地址，例如 192.168.1.23（端口默认 8899）"
            inputType = android.text.InputType.TYPE_CLASS_TEXT
            setText(app.prefs.baseUrl?.removePrefix("http://") ?: "")
        }
        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(24), dp(8), dp(24), 0)
            addView(codeInput)
            addView(addressInput)
        }
        android.app.AlertDialog.Builder(this)
            .setTitle(R.string.action_input_code)
            .setView(container)
            .setPositiveButton(R.string.action_send) { _, _ ->
                val code = codeInput.text.toString().trim()
                val address = addressInput.text.toString().trim()
                if (code.length != 6) {
                    toast(getString(R.string.error_bad_payload))
                    return@setPositiveButton
                }
                val baseUrl = normalizeAddress(address)
                if (baseUrl == null) {
                    toast("请填写 PC 上显示的监听地址")
                    return@setPositiveButton
                }
                pairWithSecret(null, baseUrl, code)
            }
            .setNegativeButton(R.string.action_cancel, null)
            .show()
    }

    /**
     * 地址容错：
     * - 中文输入法常打出全角冒号「：」→ 换成半角；
     * - 只写 IP 不写端口 → 补默认端口 8899；
     * - 没写协议 → 补 http://。
     */
    private fun normalizeAddress(raw: String): String? {
        var text = raw.trim().replace('\uFF1A', ':').replace(" ", "")
        if (text.isEmpty()) return null
        if (!text.startsWith("http://") && !text.startsWith("https://")) {
            text = "http://$text"
        }
        val host = text.substringAfter("://")
        if (!host.contains(':')) text = "$text:$DEFAULT_PC_PORT"
        return text
    }

    private fun pairWithSecret(secret: String?, baseUrl: String, code: String? = null) {
        lifecycleScope.launch {
            Log.i(TAG, "配对开始：地址=$baseUrl 方式=${if (secret != null) "扫码" else "短码"}")
            app.prefs.baseUrl = baseUrl
            try {
                // 网络调用必须在 IO 线程（lifecycleScope 默认是 Main，会抛 NetworkOnMainThreadException）
                val hello = withContext(Dispatchers.IO) { app.client.hello() }
                if (hello == null) {
                    Log.w(TAG, "探活失败（连不上或超时）")
                    toast("连不上 PC，请检查是否同一 Wi-Fi / 访客网络隔离")
                    app.prefs.baseUrl = null
                    return@launch
                }
                Log.i(TAG, "探活成功：PC=${hello.name} sid=${hello.sid}")
                val response = withContext(Dispatchers.IO) {
                    app.client.pair(secret, code, app.deviceInfo)
                }
                app.prefs.token = response.token
                app.prefs.sid = response.sid
                app.prefs.pcId = response.pcId
                app.prefs.pcName = response.pcName
                app.prefs.pairedAt = System.currentTimeMillis()
                app.prefs.wifiHandle = app.connectivity.currentHandle()
                app.setPairState(PairState.CONNECTED)
                Log.i(TAG, "配对成功：PC=${response.pcName} sid=${response.sid}")
                toast(getString(R.string.pair_success, response.pcName))
                TransferService.start(this@ScanActivity)
                finish()
            } catch (e: ApiException) {
                Log.w(TAG, "配对被拒：${e.error.code} ${e.error.message}")
                app.prefs.baseUrl = null
                toast(getString(R.string.error_pair_failed, 5))
            } catch (e: Exception) {
                Log.w(TAG, "配对异常：${e.javaClass.name}: ${e.message}", e)
                app.prefs.baseUrl = null
                toast(getString(R.string.error_pair_failed, 5))
            }
        }
    }

    private fun showHint(message: String) {
        hintText.text = message
        hintText.visibility = android.view.View.VISIBLE
    }

    private fun toast(message: String) {
        Toast.makeText(this, message, Toast.LENGTH_LONG).show()
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    private companion object {
        const val TAG = "a2share"

        /** PC 端默认端口（与 PC 的 --port 默认值一致）。 */
        const val DEFAULT_PC_PORT = 8899
    }
}
