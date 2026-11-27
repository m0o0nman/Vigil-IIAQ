// Transaction writes are staged until all reads finish (Firestore requirement).
export interface Tx {
  read<T>(path:string):Promise<T|null>
  put(path:string,value:object,merge?:boolean):void
}
export type Projection={revision:number,boot:string|null,latest:import('./engine').Result|null,
  observed:number,command:import('./engine').Command,calibration:string|null,
  buffer:Record<string,{t:number,ppm:number|null,fan:boolean}>,reason:string,drops:number,gaps:number}
export const blank=():Projection=>({revision:0,boot:null,latest:null,observed:0,command:{mode:'auto',expires:0},
  calibration:null,buffer:{},reason:'waiting',drops:0,gaps:0})
export interface Store {
  atomic<T>(work:(tx:Tx)=>Promise<T>):Promise<T>
  publish(view:Projection):Promise<number>
}
