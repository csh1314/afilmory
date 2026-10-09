import { photoLoader } from '@afilmory/data'
import { TooltipContent, TooltipPortal, TooltipProvider, TooltipRoot, TooltipTrigger } from '@afilmory/ui'
import { clsxm, focusRing } from '@afilmory/utils'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const latestModified = photoLoader
  .getPhotos()
  .reduce((latest, photo) => Math.max(latest, Date.parse(photo.lastModified) || 0), 0)

export const LibraryUpdatedAt = () => {
  const { t, i18n } = useTranslation()
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)

  if (!latestModified) {
    return null
  }

  const label = t('gallery.updated.at', {
    time: new Date(latestModified).toLocaleString(i18n.language, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }),
  })

  return (
    <TooltipProvider delayDuration={200}>
      <TooltipRoot open={open} onOpenChange={setOpen}>
        <TooltipTrigger asChild>
          <button
            ref={triggerRef}
            type="button"
            aria-label={label}
            onPointerDown={event => event.preventDefault()}
            onClick={(event) => {
              event.preventDefault()
              setOpen(value => !value)
            }}
            className={clsxm(
              'text-text-tertiary hover:text-text-secondary inline-flex size-5 items-center justify-center rounded-full transition-colors duration-200',
              focusRing,
            )}
          >
            <i className="i-mingcute-time-line text-xs lg:text-sm" />
          </button>
        </TooltipTrigger>
        <TooltipPortal>
          <TooltipContent
            side="bottom"
            align="start"
            className="text-xs"
            onPointerDownOutside={(event) => {
              if (triggerRef.current?.contains(event.target as Node)) {
                event.preventDefault()
              }
            }}
          >
            {label}
          </TooltipContent>
        </TooltipPortal>
      </TooltipRoot>
    </TooltipProvider>
  )
}
