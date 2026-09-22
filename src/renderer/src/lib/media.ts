import type { MediaStageDto, MediaTimeframeDto } from '@shared/ipc/media'

// Timeframe is canonical trading vocabulary (docs/LOCALIZATION.md §1) and is
// never translated, except the deliberately generic 'OTHER' bucket, which is
// product chrome, not a trading term.
const TIMEFRAME_LABEL: Record<MediaTimeframeDto, string> = {
  M1: '1m',
  M3: '3m',
  M5: '5m',
  M15: '15m',
  M30: '30m',
  H1: '1H',
  H2: '2H',
  H4: '4H',
  D1: 'Daily',
  W1: 'Weekly',
  OTHER: ''
}

export function timeframeLabel(timeframe: MediaTimeframeDto): string {
  return TIMEFRAME_LABEL[timeframe]
}

// Stage is product guidance, not canonical trading vocabulary, so it is
// translated. Callers resolve the key through useTranslation('journal').
const STAGE_I18N_KEY: Record<MediaStageDto, string> = {
  PRE_TRADE: 'stage.preTrade',
  ENTRY: 'stage.entry',
  MANAGEMENT: 'stage.management',
  EXIT: 'stage.exit',
  POST_TRADE: 'stage.postTrade'
}

export function stageI18nKey(stage: MediaStageDto): string {
  return STAGE_I18N_KEY[stage]
}
