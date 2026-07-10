export default class EventEmitter {
  constructor() {
    this.callbacks = {}
  }

  on(name, callback) {
    (this.callbacks[name] ??= []).push(callback)
    return this
  }

  off(name) {
    delete this.callbacks[name]
    return this
  }

  trigger(name, ...args) {
    for (const callback of this.callbacks[name] ?? []) {
      callback(...args)
    }
    return this
  }
}
