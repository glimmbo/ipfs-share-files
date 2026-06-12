import React from 'react'
import { useTranslation } from 'react-i18next'
import { useFiles } from '../../hooks/use-files.js'
import { useNodePin } from '../../hooks/use-node-pin.js'

export const PinStatus = (): React.JSX.Element | null => {
  const { t } = useTranslation()
  const { remotePinStatus, remotePinError } = useFiles()
  const { apiUrl } = useNodePin()

  if (apiUrl === '') {
    return null
  }

  if (remotePinStatus === 'idle') {
    return null
  }

  if (remotePinStatus === 'pinning') {
    return (
      <p className='mt2 mb0 f7 navy lh-copy'>
        🔵 {t('nodePinSettings.pinStatus.pinning')}
      </p>
    )
  }

  if (remotePinStatus === 'pinned') {
    return (
      <p className='mt2 mb0 f7 green lh-copy'>
        ✅ {t('nodePinSettings.pinStatus.pinned')}
      </p>
    )
  }

  return (
    <p className='mt2 mb0 f7 red lh-copy'>
      🔴 {t('nodePinSettings.pinStatus.error', { error: remotePinError ?? '' })}
    </p>
  )
}
