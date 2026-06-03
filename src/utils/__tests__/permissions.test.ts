import { describe, it, expect } from 'vitest'
import { resolveProjectAccess, meetsAccess, canCreateProject } from '../permissions.js'

describe('resolveProjectAccess', () => {
  it('org owner is lead on any project regardless of project membership', () => {
    expect(resolveProjectAccess('owner', null)).toBe('lead')
    expect(resolveProjectAccess('owner', 'viewer')).toBe('lead')
  })

  it('org admin is lead on any project regardless of project membership', () => {
    expect(resolveProjectAccess('admin', null)).toBe('lead')
    expect(resolveProjectAccess('admin', 'member')).toBe('lead')
  })

  it('org member with no project membership has no access', () => {
    expect(resolveProjectAccess('member', null)).toBeNull()
  })

  it('org member gets exactly their project role', () => {
    expect(resolveProjectAccess('member', 'lead')).toBe('lead')
    expect(resolveProjectAccess('member', 'member')).toBe('member')
    expect(resolveProjectAccess('member', 'viewer')).toBe('viewer')
  })

  it('org viewer with no project membership has no access', () => {
    expect(resolveProjectAccess('viewer', null)).toBeNull()
  })

  it('org viewer is capped at viewer even if added as project lead/member', () => {
    expect(resolveProjectAccess('viewer', 'lead')).toBe('viewer')
    expect(resolveProjectAccess('viewer', 'member')).toBe('viewer')
    expect(resolveProjectAccess('viewer', 'viewer')).toBe('viewer')
  })
})

describe('meetsAccess', () => {
  it('null never meets any requirement', () => {
    expect(meetsAccess(null, 'viewer')).toBe(false)
    expect(meetsAccess(null, 'lead')).toBe(false)
  })

  it('lead meets every requirement', () => {
    expect(meetsAccess('lead', 'viewer')).toBe(true)
    expect(meetsAccess('lead', 'member')).toBe(true)
    expect(meetsAccess('lead', 'lead')).toBe(true)
  })

  it('member meets viewer and member but not lead', () => {
    expect(meetsAccess('member', 'viewer')).toBe(true)
    expect(meetsAccess('member', 'member')).toBe(true)
    expect(meetsAccess('member', 'lead')).toBe(false)
  })

  it('viewer meets only viewer', () => {
    expect(meetsAccess('viewer', 'viewer')).toBe(true)
    expect(meetsAccess('viewer', 'member')).toBe(false)
    expect(meetsAccess('viewer', 'lead')).toBe(false)
  })
})

describe('canCreateProject', () => {
  it('only owner and admin can create projects', () => {
    expect(canCreateProject('owner')).toBe(true)
    expect(canCreateProject('admin')).toBe(true)
    expect(canCreateProject('member')).toBe(false)
    expect(canCreateProject('viewer')).toBe(false)
  })
})
