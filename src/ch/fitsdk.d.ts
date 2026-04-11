declare module "@garmin/fitsdk" {
  export class Encoder {
    constructor();
    onMesg(mesgNum: number, data: any): void;
    close(): Uint8Array;
  }
  export const Profile: any;
}
