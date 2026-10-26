// 打刻した瞬間の場所を取るための位置情報。勤務中に位置を追い続けることはしない。

import { Observable } from './observable'

export interface Fix {
  lat: number
  lng: number
  accuracy: number
  /** 位置を測った時刻 */
  timestamp: Date
}

export type Permission = 'prompt' | 'granted' | 'denied' | 'unsupported'

export class LocationService extends Observable {
  permission: Permission = 'prompt'

  /** 新しい位置が届いたとき */
  onLocation: ((fix: Fix) => void) | null = null
  /** 許可の状態が変わったとき */
  onPermissionChange: (() => void) | null = null

  private watchId: number | null = null

  constructor() {
    super()
    if (!('geolocation' in navigator)) {
      this.permission = 'unsupported'
      return
    }
    navigator.permissions
      ?.query({ name: 'geolocation' })
      .then((status) => {
        this.setPermission(status.state)
        status.onchange = () => this.setPermission(status.state)
      })
      .catch(() => undefined)
  }

  get isDenied() {
    return this.permission === 'denied' || this.permission === 'unsupported'
  }

  private setPermission(p: Permission) {
    if (this.permission === p) return
    this.permission = p
    this.changed()
    this.onPermissionChange?.()
  }

  /** 位置を取り始める（初めてのときはブラウザが許可を求める） */
  start() {
    if (this.watchId !== null || this.isDenied) return
    this.watchId = navigator.geolocation.watchPosition(
      (pos) => {
        this.setPermission('granted')
        this.onLocation?.({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          timestamp: new Date(pos.timestamp),
        })
      },
      (error) => {
        if (error.code === error.PERMISSION_DENIED) {
          this.stop()
          this.setPermission('denied')
        }
        // 取れなかったときは次の更新を待つ（打刻から10分で「位置なし」にする）
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 60_000 },
    )
  }

  stop() {
    if (this.watchId === null) return
    navigator.geolocation.clearWatch(this.watchId)
    this.watchId = null
  }
}

/**
 * 緯度・経度から住所にする（OpenStreetMap の Nominatim。電波がないと失敗する）。
 * Nominatim の利用条件（1秒に1回まで）に収まるよう、打刻のときだけ呼ぶ。
 */
export async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&accept-language=ja&lat=${lat}&lon=${lng}`
    const res = await fetch(url)
    if (!res.ok) return null
    const json = (await res.json()) as { address?: Record<string, string>; name?: string }
    const a = json.address ?? {}
    const parts = [
      a.province ?? a.state,
      a.city ?? a.town ?? a.village ?? a.county,
      a.city_district,
      a.suburb ?? a.quarter,
      a.neighbourhood,
      a.house_number,
    ].filter((p): p is string => !!p)
    // 同じ名前が続くことがあるので除く
    const address = parts.filter((p, i) => parts.indexOf(p) === i).join('')
    return address || json.name || null
  } catch {
    return null
  }
}
