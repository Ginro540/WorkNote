import { useEffect } from 'react'
import { Circle, CircleMarker, MapContainer, TileLayer, Tooltip, useMap } from 'react-leaflet'
import { latLngBounds } from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { punchKindLabel } from '../../core/attendance'
import { timeLabel } from '../../core/workCalendar'
import type { AttendancePunch } from '../../data/models'
import { colors } from '../../ui/theme'

/** 打刻場所の地図（出勤は青、退勤はオレンジ。精度の円も出す） */
export function PunchMap({ punches }: { punches: AttendancePunch[] }) {
  const located = punches.filter((p) => p.location)
  if (located.length === 0) return null
  return (
    <div className="punch-map">
      <MapContainer
        center={[located[0].location!.lat, located[0].location!.lng]}
        zoom={16}
        style={{ height: '100%', width: '100%' }}
        scrollWheelZoom={false}
        dragging={false}
        attributionControl
      >
        <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" />
        {located.map((p) => {
          const color = p.kind === 'in' ? colors.clockIn : colors.clockOut
          const c: [number, number] = [p.location!.lat, p.location!.lng]
          return (
            <span key={p.id}>
              <Circle center={c} radius={Math.max(p.location!.accuracy, 5)} pathOptions={{ color, weight: 1, fillOpacity: 0.08 }} />
              <CircleMarker center={c} radius={9} pathOptions={{ color: '#fff', weight: 2, fillColor: color, fillOpacity: 1 }}>
                <Tooltip permanent direction="top" offset={[0, -8]}>
                  {punchKindLabel(p.kind)} {timeLabel(p.punchedAt)}
                </Tooltip>
              </CircleMarker>
            </span>
          )
        })}
        <FitBounds points={located.map((p) => [p.location!.lat, p.location!.lng] as [number, number])} />
      </MapContainer>
    </div>
  )
}

function FitBounds({ points }: { points: [number, number][] }) {
  const map = useMap()
  const key = points.map((p) => p.join(',')).join(';')
  useEffect(() => {
    if (points.length > 1) map.fitBounds(latLngBounds(points), { padding: [40, 40], maxZoom: 17 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, map])
  return null
}
