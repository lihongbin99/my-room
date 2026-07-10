import Experience from './Experience.js'

// 右上角的白天/夜晚滑杆面板
export default class ThemePanel {
  constructor() {
    this.experience = new Experience()

    this.setStyles()
    this.setElement()
  }

  setStyles() {
    const style = document.createElement('style')
    style.textContent = `
      .theme-panel {
        position: fixed;
        top: 16px;
        right: 16px;
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 8px 14px;
        border-radius: 999px;
        background: rgba(20, 16, 32, 0.55);
        backdrop-filter: blur(8px);
        border: 1px solid rgba(255, 255, 255, 0.12);
        user-select: none;
        z-index: 10;
      }
      .theme-panel span { font-size: 15px; line-height: 1; }
      .theme-panel input[type="range"] {
        -webkit-appearance: none;
        appearance: none;
        width: 110px;
        height: 4px;
        border-radius: 2px;
        background: linear-gradient(90deg, #ffd88a, #3b4270);
        outline: none;
        cursor: pointer;
      }
      .theme-panel input[type="range"]::-webkit-slider-thumb {
        -webkit-appearance: none;
        appearance: none;
        width: 16px;
        height: 16px;
        border-radius: 50%;
        background: #fff;
        border: 2px solid rgba(0, 0, 0, 0.25);
        box-shadow: 0 1px 4px rgba(0, 0, 0, 0.4);
      }
      .theme-panel input[type="range"]::-moz-range-thumb {
        width: 14px;
        height: 14px;
        border-radius: 50%;
        background: #fff;
        border: 2px solid rgba(0, 0, 0, 0.25);
        box-shadow: 0 1px 4px rgba(0, 0, 0, 0.4);
      }
    `
    document.head.appendChild(style)
  }

  setElement() {
    const panel = document.createElement('div')
    panel.className = 'theme-panel'

    const sunIcon = document.createElement('span')
    sunIcon.textContent = '☀️'

    const slider = document.createElement('input')
    slider.type = 'range'
    slider.min = '0'
    slider.max = '100'
    slider.value = '0'

    const moonIcon = document.createElement('span')
    moonIcon.textContent = '🌙'

    slider.addEventListener('input', () => {
      this.experience.world.environment.setNightMix(Number(slider.value) / 100)
    })

    panel.append(sunIcon, slider, moonIcon)
    document.body.appendChild(panel)
  }
}
