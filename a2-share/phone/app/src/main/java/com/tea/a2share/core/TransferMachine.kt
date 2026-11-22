package com.tea.a2share.core

/**
 * 单条传输的状态机（PROTOCOL.md §5.1）。
 *
 * 纯函数：`next(状态, 事件) → 下一步动作`，不碰网络与文件，便于 JVM 单测。
 */
object TransferMachine {

    const val DEFAULT_CHUNK_BYTES = 4 * 1024 * 1024
    const val MAX_CHUNK_BYTES = 8 * 1024 * 1024
    const val MAX_ATTEMPTS = 3

    /** 退避节奏（毫秒）：2s / 4s / 8s。 */
    val BACKOFF_MS = longArrayOf(2_000, 4_000, 8_000)

    enum class WaitReason { BACKOFF, NO_WIFI, NEED_PAIRING, SERVER_BUSY }

    sealed interface Step {
        data object Probe : Step
        data class Init(val uploadId: String) : Step
        data class Send(val offset: Long, val length: Int) : Step
        data class Finish(val sha256: String?) : Step
        data object Done : Step
        data class Wait(val ms: Long, val reason: WaitReason) : Step
        data class Failed(val reason: String, val retryable: Boolean) : Step
    }

    enum class Event {
        PROBE_OK,
        PROBE_FAILED,
        INIT_OK,
        INIT_FAILED,
        CHUNK_OK,
        CHUNK_FAILED,
        CONFLICT,
        FINISH_OK,
        FINISH_FAILED,
        NETWORK_LOST,
        CANCELLED,
    }

    /** 传输快照。 */
    data class State(
        val uploadId: String,
        val size: Long,
        val offset: Long = 0,
        val attempts: Int = 0,
        val chunkBytes: Int = DEFAULT_CHUNK_BYTES,
    )

    /** 事件携带的附加信息。 */
    data class Detail(
        val received: Long = 0,
        val retryable: Boolean = true,
        val sha256: String? = null,
        val message: String = "",
    )

    fun next(state: State, event: Event, detail: Detail = Detail()): Step = when (event) {
        Event.PROBE_OK -> Step.Init(state.uploadId)

        Event.PROBE_FAILED -> waitOrFail(state, "连不上 PC", "PC 未连接，内容已缓存，PC 上线后会自动发送")

        Event.INIT_OK -> {
            val received = detail.received
            if (received >= state.size) Step.Finish(null)
            else Step.Send(received, chunkLength(state.size, received, state.chunkBytes))
        }

        Event.INIT_FAILED -> waitOrFail(state, detail.message.ifEmpty { "初始化上传失败" }, detail.message)

        Event.CHUNK_OK -> {
            val received = detail.received
            if (received >= state.size) Step.Finish(detail.sha256)
            else Step.Send(received, chunkLength(state.size, received, state.chunkBytes))
        }

        // 409：对齐后立即重发，**不计失败次数**
        Event.CONFLICT -> Step.Send(detail.received, chunkLength(state.size, detail.received, state.chunkBytes))

        Event.CHUNK_FAILED -> if (detail.retryable) {
            waitOrFail(state, detail.message.ifEmpty { "传输中断" }, detail.message)
        } else {
            Step.Failed(detail.message.ifEmpty { "文件校验失败，请重新发送" }, retryable = false)
        }

        Event.FINISH_OK -> Step.Done

        Event.FINISH_FAILED -> if (detail.retryable) {
            waitOrFail(state, detail.message.ifEmpty { "保存失败" }, detail.message)
        } else {
            Step.Failed(detail.message.ifEmpty { "保存失败" }, retryable = false)
        }

        Event.NETWORK_LOST -> waitOrFail(state, "网络中断", "PC 断开了，已保存进度")

        Event.CANCELLED -> Step.Failed("已取消", retryable = false)
    }

    /** 退避到下一次重试；超过 3 次就判定失败。 */
    private fun waitOrFail(state: State, reason: String, message: String): Step {
        val attempts = state.attempts + 1
        if (attempts > MAX_ATTEMPTS) {
            return Step.Failed(message.ifEmpty { reason }, retryable = false)
        }
        val delay = BACKOFF_MS[(attempts - 1).coerceIn(0, BACKOFF_MS.size - 1)]
        return Step.Wait(delay, WaitReason.BACKOFF)
    }

    fun chunkLength(size: Long, offset: Long, chunkBytes: Int = DEFAULT_CHUNK_BYTES): Int {
        val limit = chunkBytes.coerceIn(1, MAX_CHUNK_BYTES)
        val remaining = size - offset
        if (remaining <= 0) return 0
        return minOf(remaining, limit.toLong()).toInt()
    }
}
