/**
 * 空态欢迎块（step 风格）：版本边框 + 像素 logo + model/cwd 信息列 + Tips 三条 + 空态提示行。
 *
 * 内容必须是 TBox 的 children（兄弟节点会被盒体自身的填充覆盖，实测结论）；
 * child 坐标相对内框。转写区不够高时（< 边框 + 1 行）只留空态提示行，不画盒子。
 */
import { defineComponent, h, type PropType } from 'vue'
import { TText } from '@simon_he/vue-tui'
import { TBox } from '@simon_he/vue-tui/vue'
import { COMMANDS, EMPTY_NOTE } from '../texts.ts'
import { APP_ART, APP_VERSION } from '../../core/brand.ts'
import { styles } from '../../core/theme.ts'

/** 边框 2 + logo 区 + 空行 + Tips 标签与 3 条（child y0..11 → 内框 12 行） */
const BOX_H = 14
const TIP_CMDS = ['/rpc', '/sessions', '/help'] as const

export const WelcomeBlock = defineComponent({
  name: 'WelcomeBlock',
  props: {
    cols: { type: Number, required: true },
    /** 转写区高度：决定画不画欢迎块 */
    transcriptH: { type: Number, required: true },
    /** 欢迎块 model 行显示什么（rpc = 后端握手确认的 id，mock = 离线剧本） */
    model: { type: String, default: '' },
  },
  setup(props) {
    return () => {
      const cols = props.cols
      const showBox = props.transcriptH >= BOX_H + 1
      return [
        ...(showBox
          ? [
              h(
                TBox,
                {
                  x: 0,
                  y: 0,
                  w: cols,
                  h: BOX_H,
                  border: true,
                  title: ` ${APP_VERSION} `,
                  padding: 0,
                  style: styles.divider,
                },
                () => [
                  // 像素 logo（紫色）
                  ...APP_ART.map((line, i) =>
                    h(TText, { x: 1, y: i, w: 12, h: 1, value: line, style: styles.logo }),
                  ),
                  // 右侧信息：label 灰、value 蓝（值列对齐）
                  h(TText, { x: 15, y: 1, w: 6, h: 1, value: 'model', style: styles.infoLabel }),
                  h(TText, {
                    x: 22,
                    y: 1,
                    w: Math.max(8, cols - 25),
                    h: 1,
                    value: props.model,
                    style: styles.infoValue,
                  }),
                  h(TText, { x: 15, y: 2, w: 4, h: 1, value: 'cwd', style: styles.infoLabel }),
                  h(TText, { x: 22, y: 2, w: Math.max(8, cols - 25), h: 1, value: process.cwd(), style: styles.infoValue }),
                  // Tips：命令蓝、说明灰（desc 与 /help 同源 COMMANDS）
                  h(TText, { x: 1, y: 8, w: 8, h: 1, value: 'Tips', style: styles.infoLabel }),
                  ...TIP_CMDS.flatMap((cmd, i) => {
                    const item = COMMANDS.find((c) => c.cmd === cmd)
                    if (!item) return []
                    return [
                      h(TText, { x: 1, y: 9 + i, w: 12, h: 1, value: cmd, style: styles.tipCmd }),
                      h(TText, { x: 13, y: 9 + i, w: Math.max(8, cols - 16), h: 1, value: item.desc, style: styles.tipDesc }),
                    ]
                  }),
                ],
              ),
            ]
          : []),
        h(TText, {
          x: 2,
          y: BOX_H + 1,
          w: Math.max(10, cols - 4),
          h: 1,
          style: styles.faint,
          value: EMPTY_NOTE,
        }),
      ]
    }
  },
})
