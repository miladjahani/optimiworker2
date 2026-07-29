import { api } from './api'

type BuilderState = {
  table: string; op: 'select'|'insert'|'update'|'delete'; payload?: any;
  filters: Record<string, any>; orderBy?: { column: string; ascending?: boolean };
  limitValue?: number; selectColumns?: string; countExact?: boolean; head?: boolean;
}
class Builder<T=any> implements PromiseLike<any> {
  s: BuilderState
  constructor(table:string, op:'select'|'insert'|'update'|'delete'='select', payload?:any) {
    this.s={table,op,payload,filters:{}}
  }
  select(columns='*', opts?:any){ this.s.selectColumns=columns; this.s.countExact=opts?.count==='exact'; this.s.head=opts?.head===true; return this }
  order(column:string, opts?:any){ this.s.orderBy={column,ascending:opts?.ascending!==false}; return this }
  limit(n:number){ this.s.limitValue=n; return this }
  eq(column:string,value:any){ this.s.filters[column]=value; return this }
  maybeSingle(){ (this.s as any).single=true; return this }
  single(){ (this.s as any).single=true; return this }
  insert(payload:any){ return new Builder<T>(this.s.table,'insert',payload) as any }
  update(payload:any){ return new Builder<T>(this.s.table,'update',payload) as any }
  delete(){ return new Builder<T>(this.s.table,'delete') as any }
  then(onfulfilled:any,onrejected?:any){ return api.db<any>({
    table:this.s.table, op:this.s.op, payload:this.s.payload, filters:this.s.filters,
    orderBy:this.s.orderBy, limit:this.s.limitValue, columns:this.s.selectColumns,
    countExact:this.s.countExact, head:this.s.head, single:(this.s as any).single
  }).then(onfulfilled,onrejected) }
}
export const db = { from: <T=any>(table:string) => new Builder<T>(table) }
