import { Board } from './board/Board'
import { CampaignEnd, CityHud } from './campaign/CampaignUI'
import { useStore } from './game/store'
import { EndScreen } from './ui/EndScreen'
import { Hud } from './ui/Hud'
import { StartScreen } from './ui/StartScreen'

export function App(): React.JSX.Element {
  const screen = useStore((s) => s.screen)
  return (
    <>
      <Board />
      {screen === 'play' && <Hud />}
      {screen === 'start' && <StartScreen />}
      {screen === 'end' && <EndScreen />}
      {screen === 'city' && <CityHud />}
      {screen === 'cend' && <CampaignEnd />}
      <div className="fx-scan" />
      <div className="fx-vig" />
    </>
  )
}
