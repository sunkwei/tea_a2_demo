package com.tea.a2share.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class TransferMachineTest {

    private fun state(size: Long = 100L, offset: Long = 0L, attempts: Int = 0) =
        TransferMachine.State(uploadId = "u1", size = size, offset = offset, attempts = attempts)

    @Test
    fun `探测通过后进入初始化`() {
        val step = TransferMachine.next(state(), TransferMachine.Event.PROBE_OK)
        assertEquals(TransferMachine.Step.Init("u1"), step)
    }

    @Test
    fun `初始化返回服务端偏移后开始发送`() {
        val step = TransferMachine.next(
            state(),
            TransferMachine.Event.INIT_OK,
            TransferMachine.Detail(received = 40),
        )
        assertEquals(TransferMachine.Step.Send(40, 60), step)
    }

    @Test
    fun `偏移冲突立即对齐且不增加失败次数`() {
        val step = TransferMachine.next(
            state(attempts = 1),
            TransferMachine.Event.CONFLICT,
            TransferMachine.Detail(received = 40),
        )
        assertEquals(TransferMachine.Step.Send(40, 60), step)
    }

    @Test
    fun `发完最后一块进入 finish`() {
        val step = TransferMachine.next(
            state(size = 100, offset = 60),
            TransferMachine.Event.CHUNK_OK,
            TransferMachine.Detail(received = 100),
        )
        assertTrue(step is TransferMachine.Step.Finish)
    }

    @Test
    fun `可重试失败进入退避`() {
        val step = TransferMachine.next(
            state(),
            TransferMachine.Event.CHUNK_FAILED,
            TransferMachine.Detail(retryable = true, message = "网络中断"),
        )
        assertEquals(TransferMachine.Step.Wait(2_000, TransferMachine.WaitReason.BACKOFF), step)
    }

    @Test
    fun `不可重试失败直接判失败`() {
        val step = TransferMachine.next(
            state(),
            TransferMachine.Event.CHUNK_FAILED,
            TransferMachine.Detail(retryable = false, message = "文件校验失败"),
        )
        assertEquals(TransferMachine.Step.Failed("文件校验失败", retryable = false), step)
    }

    @Test
    fun `连续失败超过三次判定失败`() {
        var current = state(attempts = 3)
        val step = TransferMachine.next(
            current,
            TransferMachine.Event.CHUNK_FAILED,
            TransferMachine.Detail(retryable = true, message = "还是不行"),
        )
        assertTrue(step is TransferMachine.Step.Failed)
    }

    @Test
    fun `finish 成功即完成`() {
        val step = TransferMachine.next(state(), TransferMachine.Event.FINISH_OK)
        assertEquals(TransferMachine.Step.Done, step)
    }

    @Test
    fun `网络中断保留进度等待重试`() {
        val step = TransferMachine.next(state(offset = 40), TransferMachine.Event.NETWORK_LOST)
        assertTrue(step is TransferMachine.Step.Wait)
    }

    @Test
    fun `块大小默认 4 MiB 且不超过 8 MiB`() {
        assertEquals(TransferMachine.DEFAULT_CHUNK_BYTES, TransferMachine.chunkLength(100L * 1024 * 1024, 0))
        assertEquals(TransferMachine.MAX_CHUNK_BYTES, TransferMachine.chunkLength(100L * 1024 * 1024, 0, 16 * 1024 * 1024))
        assertTrue(TransferMachine.chunkLength(100L * 1024 * 1024, 0) <= 8 * 1024 * 1024)
    }
}
