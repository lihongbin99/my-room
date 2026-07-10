import Experience from '../Experience.js'
import Environment from './Environment.js'
import Room from './Room.js'
import ComputerZone from './ComputerZone.js'
import TVZone from './TVZone.js'
import Bookshelf from './Bookshelf.js'

export default class World {
  constructor() {
    this.experience = new Experience()
    this.scene = this.experience.scene

    this.room = new Room()
    this.computerZone = new ComputerZone()
    this.tvZone = new TVZone()
    this.bookshelf = new Bookshelf()
    this.environment = new Environment()
  }

  update() {
    this.environment.update()
    this.computerZone.update()
    this.bookshelf.update()
    this.tvZone.update() // 放在 bookshelf 之后：光标样式让后写的（电视悬停）赢
  }
}
