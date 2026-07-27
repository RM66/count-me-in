export type MakeOptional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>

export type MakeRequired<T, K extends keyof T> = Omit<T, K> & Required<Pick<T, K>>
