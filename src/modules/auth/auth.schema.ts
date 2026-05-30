import { z } from 'zod'

export const registerSchema = z.object({
  name:     z.string().min(2, 'Name must be at least 2 characters').max(255),
  email:    z.email('Invalid email address').max(255),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  jobTitle: z.enum([
    'engineer',
    'designer',
    'product_manager',
    'marketer',
    'founder',
    'other',
  ]).optional(),
})

export const loginSchema = z.object({
  email:    z.email('Invalid email address').max(255),
  password: z.string().min(1, 'Password is required'),
})

export const forgotPasswordSchema = z.object({
  email: z.email('Invalid email address').max(255),
})

export const resetPasswordSchema = z.object({
  token:    z.string().min(1, 'Token is required'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
})
