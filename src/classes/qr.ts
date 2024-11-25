import EventEmitter from "node:events";

export default class QR extends EventEmitter {
  private _qr: string;

  constructor() {
    super();
    this._qr = "";
  }

  get qr() {
    return this._qr;
  }

  set qr(value) {
    if (this._qr !== value) {
      this._qr = value;
      this.emit("change", value);
    }
  }
}
