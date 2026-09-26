/**
 * 贴图域（Alt+V 多模态输入）：待发图片、输入行右端的指示条、占位符文案、剪贴板读取。
 *
 * rpc 一律可贴：是否降级由后端按 capabilities 决定（不支持的模型把图片投影为文本占位符，
 * 请求照常成功），前端只按 config/get 的 capabilities 决定提示文案。mock 直接拒绝。
 */
import { computed, ref, type ComputedRef, type Ref } from 'vue'
import { readClipboardImage } from '../clipboard.ts'
import { IMAGE_HINT, IMAGE_NOTE_EMPTY, IMAGE_NOTE_MOCK, PLACEHOLDER, imageChip, imageNoteDegraded, imageNoteReady } from '../texts.ts'
import type { RawImage } from '../../session/seam.ts'
import type { TranscriptStore } from '../../transcript/index.ts'
import type { SessionController } from './useSessionController.ts'

export type ImageAttachment = Readonly<{
  /** 待发送图片：非空时输入行右端显示指示条，随下一条消息发出后清空 */
  pending: Ref<{ data: string; bytes: number } | null>
  /** 指示条文本（空串 = 不显示） */
  chipText: ComputedRef<string>
  /** 输入框占位符（rpc 会多一句 Alt+V 提示） */
  placeholderText: ComputedRef<string>
  /** Alt+V：读剪贴板图片 → pending（重复按覆盖） */
  paste(): Promise<void>
  /** 取出待发图片并清空指示条（普通消息路径调用；'/' 命令不携带图片） */
  take(): RawImage[] | undefined
}>

export function useImageAttachment(deps: {
  session: SessionController
  /** 当前模型是否声明 image_in（由模型域提供） */
  imageSupported: ComputedRef<boolean>
  store: TranscriptStore
}): ImageAttachment {
  const { session, imageSupported, store } = deps

  const pending = ref<{ data: string; bytes: number } | null>(null)
  const chipText = computed(() =>
    pending.value ? imageChip(Math.max(1, Math.round(pending.value.bytes / 1024))) : '',
  )
  const placeholderText = computed(() =>
    session.sessionRef.value.kind === 'rpc' ? PLACEHOLDER + IMAGE_HINT : PLACEHOLDER)

  async function paste(): Promise<void> {
    if (session.sessionRef.value.kind !== 'rpc') {
      store.addNote(IMAGE_NOTE_MOCK)
      return
    }
    const img = await readClipboardImage()
    if (!img) {
      store.addNote(IMAGE_NOTE_EMPTY)
      return
    }
    pending.value = { data: img.data, bytes: img.bytes }
    const kb = Math.max(1, Math.round(img.bytes / 1024))
    store.addNote(imageSupported.value ? imageNoteReady(kb) : imageNoteDegraded(kb))
  }

  function take(): RawImage[] | undefined {
    const images: RawImage[] | undefined = pending.value
      ? [{ media_type: 'image/png', data: pending.value.data }]
      : undefined
    pending.value = null
    return images
  }

  return { pending, chipText, placeholderText, paste, take }
}
