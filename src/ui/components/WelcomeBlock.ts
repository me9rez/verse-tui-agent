/**
 * 空态欢迎块（step 风格）：版本边框 + 像素 logo + model/cwd 信息列 + 空态提示行。
 *
 * 内容必须是 TBox 的 children（兄弟节点会被盒体自身的填充覆盖，实测结论）；
 * child 坐标相对内框。转写区不够高时（< 边框 + 1 行）只留空态提示行，不画盒子。
 * 命令/快捷键 Tips 归右列（components/TipsColumn.ts），这里不再重复一份。
 */
import { defineComponent, h, type PropType } from 'vue'
import { TText } from '@simon_he/vue-tui'
import { TBox } from '@simon_he/vue-tui/vue'
import { EMPTY_NOTE } from '../texts.ts'
import { APP_ART, APP_VERSION } from '../../core/brand.ts'
import { styles } from '../../core/theme.ts'

/** 盒子总高：边框 2 + 内框 7（APP_ART 7 行；model/cwd 与它并排，不额外占行） */
const BOX_H = 9

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
                ],
              ),
            ]
          : []),
        h(TText, {
          x: 2,
          // 提示行跟在盒子下面；转写区放不下盒子时也绝不许越界到分割线/输入行上
          y: Math.min(BOX_H + 1, Math.max(0, props.transcriptH - 1)),
          w: Math.max(10, cols - 4),
          h: 1,
          style: styles.faint,
          value: EMPTY_NOTE,
        }),
      ]
    }
  },
})
