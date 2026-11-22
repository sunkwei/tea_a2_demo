package com.tea.a2share

import android.app.Application
import android.content.Context
import android.os.Build
import com.tea.a2share.core.DeviceInfo
import com.tea.a2share.core.PairState
import com.tea.a2share.data.DbHelper
import com.tea.a2share.data.Files
import com.tea.a2share.data.Prefs
import com.tea.a2share.data.QueueDao
import com.tea.a2share.data.QueueItem
import com.tea.a2share.data.QueueRepository
import com.tea.a2share.net.ConnectivityMonitor
import com.tea.a2share.net.HttpTransport
import com.tea.a2share.net.HttpUrlTransport
import com.tea.a2share.net.PcClient
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.util.UUID

/**
 * 进程级容器（手写单例，不用 DI 框架）。
 */
class App : Application() {

    lateinit var prefs: Prefs
        private set
    lateinit var files: Files
        private set
    lateinit var repository: QueueRepository
        private set
    lateinit var transport: HttpTransport
        private set
    lateinit var client: PcClient
        private set
    lateinit var connectivity: ConnectivityMonitor
        private set

    val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    private val _pairState = MutableStateFlow(PairState.UNPAIRED)
    val pairState: StateFlow<PairState> = _pairState.asStateFlow()

    private val _queue = MutableStateFlow<List<QueueItem>>(emptyList())
    val queue: StateFlow<List<QueueItem>> = _queue.asStateFlow()

    val deviceId: String
        get() = prefs.deviceId

    val deviceInfo: DeviceInfo
        get() = DeviceInfo(
            id = prefs.deviceId,
            name = prefs.deviceName,
            model = "${Build.MANUFACTURER} ${Build.MODEL}".trim(),
            android = Build.VERSION.SDK_INT,
            app = BuildConfig.VERSION_NAME,
        )

    override fun onCreate() {
        super.onCreate()
        instance = this
        prefs = Prefs(this)
        files = Files(filesDir)
        val dao = QueueDao(DbHelper(this))
        repository = QueueRepository(dao, files)
        transport = HttpUrlTransport({ prefs.baseUrl ?: "" }, prefs.deviceId)
        client = PcClient(transport)
        connectivity = ConnectivityMonitor(this)
        refreshQueue()
    }

    fun refreshQueue() {
        _queue.value = repository.list()
    }

    fun setPairState(state: PairState) {
        _pairState.value = state
    }

    /** 离开 Wi-Fi 作用域或 PC 重启：作废凭据（队列内容不受影响，FR-Q09）。 */
    fun invalidateSession() {
        prefs.clearSession()
        setPairState(PairState.UNPAIRED)
    }

    companion object {
        lateinit var instance: App
            private set

        fun of(context: Context): App = instance
    }
}
