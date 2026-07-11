import Experience from '../Experience.js'
import Environment from './Environment.js'
import Room from './Room.js'
import ComputerZone from './ComputerZone.js'
import TVZone from './TVZone.js'
import Bookshelf from './Bookshelf.js'
import FloorLamp from './FloorLamp.js'
import WallWindow from './WallWindow.js'
import DeskGlow from './DeskGlow.js'

export default class World {
  constructor() {
    this.experience = new Experience()
    this.scene = this.experience.scene

    this.room = new Room()
    this.computerZone = new ComputerZone()
    this.tvZone = new TVZone()
    this.bookshelf = new Bookshelf()
    this.environment = new Environment()
    this.floorLamp = new FloorLamp()
    this.wallWindow = new WallWindow()
    this.deskGlow = new DeskGlow()
  }

  update() {
    this.environment.update()
    this.floorLamp.update() // 在 environment 之后：读当帧最新 currentMix
    this.wallWindow.update()
    this.deskGlow.update()
    this.computerZone.update()
    this.bookshelf.update()
    this.tvZone.update() // 放在 bookshelf 之后：光标样式让后写的（电视悬停）赢
    // 书架每帧无条件写 cursor，显示器悬停要在它之后跑才不被冲掉（区域互不重叠，只是写序问题）
    this.computerZone.xpScreen?.update()
  }
}
