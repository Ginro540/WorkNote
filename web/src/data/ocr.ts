// 領収書の文字をスマホの中で読み取る（Tesseract.js）。画像は外部に送らない。
// 読み取りの仕組み（約数MB）は初めて使うときに読み込み、あとはスマホに保存される。

import { normalize, parseReceiptLines, type ReceiptFields } from '../core/receipt'

export interface OcrResult {
  text: string
  fields: ReceiptFields
}

type Worker = Awaited<ReturnType<typeof import('tesseract.js').createWorker>>

let workerPromise: Promise<Worker> | null = null
let progressHandler: ((ratio: number) => void) | undefined

function getWorker() {
  workerPromise ??= import('tesseract.js')
    .then(({ createWorker }) =>
      createWorker(['jpn', 'eng'], 1, {
        logger: (m: { status: string; progress: number }) => {
          if (m.status === 'recognizing text') progressHandler?.(m.progress)
        },
      }),
    )
    .catch((e) => {
      workerPromise = null // 電波がないときなどは次にもう一度
      throw e
    })
  return workerPromise
}

/** 日本語の文字の間に入る空白を取る（「領 収 書」→「領収書」） */
const cjk = '\\u3000-\\u30ff\\u3400-\\u9fff\\uff00-\\uffef'
const joinCjk = (s: string) => s.replace(new RegExp(`(?<=[${cjk}])\\s+(?=[${cjk}])`, 'g'), '')

export async function recognizeReceipt(image: Blob, onProgress?: (ratio: number) => void): Promise<OcrResult> {
  const worker = await getWorker()
  progressHandler = onProgress
  try {
    const { data } = await worker.recognize(image)
    const lines = data.text
      .split(/\r?\n/)
      .map((l: string) => joinCjk(normalize(l)).trim())
      .filter((l: string) => l.length > 0)
    return { text: lines.join('\n'), fields: parseReceiptLines(lines) }
  } finally {
    progressHandler = undefined
  }
}
