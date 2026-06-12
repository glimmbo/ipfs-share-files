import classnames from 'classnames'
import React, { useCallback, useEffect, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { useNodePin } from '../../hooks/use-node-pin.js'

export const NodePinSettings = (): React.JSX.Element | null => {
  const { t } = useTranslation()
  const { apiUrl, apiKey, connectionStatus, connectionError, remotePeerId, setConfig, testConnection } = useNodePin()

  const [open, setOpen] = useState(false)
  const [urlInput, setUrlInput] = useState(apiUrl)
  const [keyInput, setKeyInput] = useState(apiKey)

  // Keep inputs in sync when context values are loaded from localStorage on mount
  useEffect(() => {
    setUrlInput(apiUrl)
    setKeyInput(apiKey)
  }, [apiUrl, apiKey])

  const handleSave = useCallback(() => {
    setConfig(urlInput, keyInput)
  }, [urlInput, keyInput, setConfig])

  const handleTest = useCallback(async () => {
    setConfig(urlInput, keyInput)
    await testConnection()
  }, [urlInput, keyInput, setConfig, testConnection])

  const statusIcon = (): string => {
    if (connectionStatus === 'connecting') return '🔵'
    if (connectionStatus === 'connected') return '✅'
    if (connectionStatus === 'error') return '🔴'
    return apiUrl !== '' ? '⚫' : '⚙️'
  }

  const toggleBtnClass = classnames(
    'pa2 f7 br-pill pointer flex items-center gap1 bg-white navy ba b--light-gray'
  )

  return (
    <div className='mt3'>
      <button className={toggleBtnClass} onClick={() => { setOpen(o => !o) }} aria-expanded={open}>
        <span>{statusIcon()}</span>
        <span className='ml1'>{t('nodePinSettings.toggleLabel')}</span>
        <span className='ml1'>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className='mt2 pa3 br3 bg-near-white ba b--light-gray'>
          <p className='ma0 mb2 f6 fw6 charcoal'>{t('nodePinSettings.title')}</p>
          <p className='ma0 mb3 f7 charcoal-muted lh-copy'>{t('nodePinSettings.description')}</p>

          <label className='db f7 charcoal mb1' htmlFor='node-pin-api-url'>
            {t('nodePinSettings.apiUrlLabel')}
          </label>
          <input
            id='node-pin-api-url'
            type='url'
            className='w-100 pa2 f7 br2 ba b--light-gray mb2'
            placeholder='http://localhost:5001'
            value={urlInput}
            onChange={e => { setUrlInput(e.target.value) }}
          />

          <label className='db f7 charcoal mb1' htmlFor='node-pin-api-key'>
            {t('nodePinSettings.apiKeyLabel')}
          </label>
          <input
            id='node-pin-api-key'
            type='password'
            className='w-100 pa2 f7 br2 ba b--light-gray mb3'
            placeholder={t('nodePinSettings.apiKeyPlaceholder')}
            value={keyInput}
            onChange={e => { setKeyInput(e.target.value) }}
          />

          <div className='flex gap2'>
            <button
              className='pa2 w4 f7 br-pill pointer bg-navy white ba b--navy'
              onClick={() => { void handleTest() }}
              disabled={connectionStatus === 'connecting' || urlInput.trim() === ''}
            >
              {connectionStatus === 'connecting' ? t('nodePinSettings.testing') : t('nodePinSettings.testBtn')}
            </button>
            <button
              className='pa2 w4 f7 br-pill pointer bg-white navy ba b--navy ml2'
              onClick={handleSave}
            >
              {t('nodePinSettings.saveBtn')}
            </button>
          </div>

          {connectionStatus === 'connected' && remotePeerId !== null && (
            <p className='mt2 mb0 f7 green lh-copy'>
              ✅ {t('nodePinSettings.connected', { peerId: remotePeerId })}
            </p>
          )}
          {connectionStatus === 'error' && connectionError !== null && (
            <p className='mt2 mb0 f7 red lh-copy'>
              🔴 {connectionError}
            </p>
          )}

          <p className='mt3 mb0 f7 charcoal-muted lh-copy'>
            <Trans i18nKey='nodePinSettings.corsNote'>
              Your IPFS node must have CORS configured to allow requests from this origin.{' '}
              <a
                className='link aqua underline-hover'
                href='https://docs.ipfs.tech/reference/kubo/config/#apiheadersaccess-control-allow-origin'
                target='_blank'
                rel='noopener noreferrer'
              >
                See Kubo docs
              </a>.
            </Trans>
          </p>
        </div>
      )}
    </div>
  )
}
