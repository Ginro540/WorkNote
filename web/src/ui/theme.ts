import { createTheme } from '@mantine/core'
import {
  IconCoffee,
  IconDots,
  IconGasStation,
  IconHammer,
  IconMail,
  IconParking,
  IconToolsKitchen2,
  IconTrain,
  type Icon,
} from '@tabler/icons-react'

const font = '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", "Yu Gothic", "Meiryo", system-ui, sans-serif'

export const theme = createTheme({
  primaryColor: 'blue',
  fontFamily: font,
  headings: { fontFamily: font },
  defaultRadius: 'md',
})

/** iOS 版の Theme.swift と同じ色 */
export const colors = {
  accent: '#3D7BF6',
  clockIn: '#4F7BF7',
  clockOut: '#FF9A3C',
  saturday: '#1E88E5',
  holiday: '#E53935',
  warning: '#F08C00',
  expense: '#8B5CF6',
  report: '#1E8FC4',
  reportGreen: '#22B07D',
}

export const gradients = {
  clockIn: 'linear-gradient(135deg, #4A8BFF, #5B5CE6)',
  clockOut: 'linear-gradient(135deg, #FFB04A, #FF7A3D)',
  login: 'linear-gradient(180deg, #5B9BFF, #5662F0, #8A5BE0)',
  report: 'linear-gradient(90deg, #22B07D, #1E8FC4)',
  expense: 'linear-gradient(90deg, #8B5CF6, #EC4899)',
}

/** 状態の札の色 */
export const statusColor = {
  draft: 'gray',
  submitted: colors.accent,
  approved: 'green',
  returned: colors.warning,
  pending: colors.warning,
  rejected: 'red',
  cancelled: 'gray',
} as const

/** 経費の区分ごとの色とアイコン */
export function categoryStyle(id: string): { color: string; icon: Icon } {
  switch (id) {
    case 'travel':
      return { color: '#3B82F6', icon: IconTrain }
    case 'parking':
      return { color: '#6366F1', icon: IconParking }
    case 'fuel':
      return { color: '#FB8C1E', icon: IconGasStation }
    case 'supplies':
      return { color: '#A97B5C', icon: IconHammer }
    case 'meeting':
      return { color: '#14B8C4', icon: IconCoffee }
    case 'entertainment':
      return { color: '#E5487A', icon: IconToolsKitchen2 }
    case 'communication':
      return { color: '#22A06B', icon: IconMail }
    default:
      return { color: '#8E8E93', icon: IconDots }
  }
}
