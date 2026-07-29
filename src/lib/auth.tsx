import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import { api } from './api'

type User = { id: string; email: string }
interface AuthContextType {
  session: { user: User } | null
  user: User | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<{ error: string | null }>
  signUp: (email: string, password: string) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
}
const AuthContext = createContext<AuthContextType>({
  session:null,user:null,loading:true,
  signIn:async()=>({error:'not implemented'}), signUp:async()=>({error:'not implemented'}), signOut:async()=>{}
})
export function AuthProvider({children}:{children:ReactNode}) {
  const [user,setUser]=useState<User|null>(null)
  const [loading,setLoading]=useState(true)
  const refresh=async()=>{ try { const r=await api.me(); setUser(r.user) } catch { setUser(null) } finally { setLoading(false) } }
  useEffect(()=>{refresh()},[])
  const signIn=async(email:string,password:string)=>{try{const r=await api.login(email,password);setUser(r.user);return {error:null}}catch(e){return {error:e instanceof Error?e.message:String(e)}}}
  const signUp=async(email:string,password:string)=>{try{const r=await api.signup(email,password);setUser(r.user);return {error:null}}catch(e){return {error:e instanceof Error?e.message:String(e)}}}
  const signOut=async()=>{await api.logout();setUser(null)}
  return <AuthContext.Provider value={{session:user?{user}:null,user,loading,signIn,signUp,signOut}}>{children}</AuthContext.Provider>
}
export function useAuth(){return useContext(AuthContext)}
