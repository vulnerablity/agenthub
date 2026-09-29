import { useEffect, useState } from 'react'
import { organizationApi } from '@/api'

interface Props {
  name: string
  avatarUrl?: string | null
  organizationId?: number
  size?: 'sm' | 'md' | 'lg'
}

// function tone(name: string): string {
//   let hash = 0
//   for (const char of name) hash = (hash * 31 + char.codePointAt(0)!) | 0
//   return `av-${(Math.abs(hash) % 6) + 1}`
// }

export default function OrganizationAvatar({ name, avatarUrl, organizationId, size = 'md' }: Props) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const [loadedAvatar, setLoadedAvatar] = useState<{ key: string; url: string } | null>(null)
  const blobUrl = loadedAvatar && loadedAvatar.key === avatarUrl ? loadedAvatar.url : null
  useEffect(() => {
    let live = true
    let objectUrl: string | null = null
    if (avatarUrl && organizationId != null) {
      organizationApi.getAvatar(organizationId).then(({ data }) => {
        objectUrl = URL.createObjectURL(data)
        if (live) setLoadedAvatar({ key: avatarUrl, url: objectUrl })
        else URL.revokeObjectURL(objectUrl)
      }).catch(() => {
        if (live) setFailedUrl(avatarUrl)
      })
    }
    return () => {
      live = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [avatarUrl, organizationId])
  if (!avatarUrl || failedUrl === avatarUrl) {
    return (
      <span className={`avatar ${size} org-av org-avatar`} aria-label={`${name}组织头像`}>
        {Array.from(name.trim())[0]?.toUpperCase() ?? '?'}
      </span>
    )
  }
  return (
    <img
      src={blobUrl ?? undefined}
      style={{ visibility: blobUrl ? 'visible' : 'hidden' }}
      alt={`${name}组织头像`}
      className={`avatar ${size} shrink-0 object-cover`}
      onError={() => setFailedUrl(avatarUrl)}
    />
  )
}
