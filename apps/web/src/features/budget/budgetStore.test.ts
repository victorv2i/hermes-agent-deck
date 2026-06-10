import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import {
  BUDGET_STORAGE_KEY,
  getBudget,
  hasBudget,
  parseBudget,
  readStoredBudget,
  setBudget,
  useBudget,
} from './budgetStore'

beforeEach(() => {
  localStorage.clear()
  setBudget({ daily: null, monthly: null })
  localStorage.clear()
})

afterEach(() => {
  setBudget({ daily: null, monthly: null })
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('parseBudget', () => {
  it('reads valid daily + monthly caps', () => {
    expect(parseBudget('{"daily":10,"monthly":300}')).toEqual({ daily: 10, monthly: 300 })
  })
  it('normalizes zero/negative/NaN/missing caps to null', () => {
    expect(parseBudget('{"daily":0,"monthly":-5}')).toEqual({ daily: null, monthly: null })
    expect(parseBudget('{}')).toEqual({ daily: null, monthly: null })
  })
  it('tolerates corrupt JSON and null', () => {
    expect(parseBudget('not json')).toEqual({ daily: null, monthly: null })
    expect(parseBudget(null)).toEqual({ daily: null, monthly: null })
  })
})

describe('budget persistence', () => {
  it('persists a set budget to localStorage', () => {
    setBudget({ daily: 12 })
    expect(getBudget()).toEqual({ daily: 12, monthly: null })
    expect(readStoredBudget()).toEqual({ daily: 12, monthly: null })
    expect(JSON.parse(localStorage.getItem(BUDGET_STORAGE_KEY)!)).toEqual({
      daily: 12,
      monthly: null,
    })
  })
  it('merges a partial update, leaving the other cap intact', () => {
    setBudget({ daily: 12 })
    setBudget({ monthly: 300 })
    expect(getBudget()).toEqual({ daily: 12, monthly: 300 })
  })
  it('clearing a cap (null) leaves it unset', () => {
    setBudget({ daily: 12, monthly: 300 })
    setBudget({ daily: null })
    expect(getBudget()).toEqual({ daily: null, monthly: 300 })
  })
})

describe('hasBudget', () => {
  it('is false when both caps unset, true when either is set', () => {
    expect(hasBudget({ daily: null, monthly: null })).toBe(false)
    expect(hasBudget({ daily: 5, monthly: null })).toBe(true)
    expect(hasBudget({ daily: null, monthly: 100 })).toBe(true)
  })
})

describe('useBudget', () => {
  it('reflects the store and updates reactively', () => {
    const { result } = renderHook(() => useBudget())
    expect(result.current.budget).toEqual({ daily: null, monthly: null })
    act(() => result.current.setDaily(15))
    expect(result.current.budget.daily).toBe(15)
    act(() => result.current.setMonthly(400))
    expect(result.current.budget.monthly).toBe(400)
    act(() => result.current.setDaily(null))
    expect(result.current.budget).toEqual({ daily: null, monthly: 400 })
  })
})
