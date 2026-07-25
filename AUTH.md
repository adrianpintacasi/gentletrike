# Authentication & Registration Guide

This document outlines how authentication, user registration, and admin management function in the GentleTrike application.

## 1. Core Authentication System

GentleTrike uses a custom session-based authentication system backed by a cloud PostgreSQL database (Neon).

*   **Database Tables**: 
    *   `users`: Stores core user data (`id`, `email`, `password_hash`, `name`, `role`, `created_at`).
    *   `sessions`: Maps active session tokens to specific `user_id`s with an expiration date.
*   **Tokens**: Upon successful login or registration, the backend generates a secure, random session token.
*   **Frontend Handling**: The React frontend (via `AuthContext.tsx`) stores this token locally. Every authenticated API request attaches this token in the `Authorization` header as a `Bearer <token>`.
*   **Backend Validation**: API routes that require a logged-in user are protected by the `requireAuth` middleware, which verifies the Bearer token against the `sessions` table.

## 2. User Registration Process

The standard user registration process is handled via the `POST /api/auth/register` endpoint.

*   **Roles**: Standard registration allows users to sign up as either a `passenger` or a `rider`.
*   **Validation**:
    *   Passwords must be at least 8 characters.
    *   Emails must be valid and unique.
*   **Rider-Specific Logic**: If a user selects the `rider` role, they *must* provide their pedicab `unitNumber`. The backend automatically hooks into the ride-hailing system by creating a corresponding entry in the `drivers` table (via the `createRiderDriver` function). This ensures the rider's profile is immediately ready to accept rides.
*   **Auto-Login**: Upon successful registration, the backend instantly creates a session token for the new user and logs them in, seamlessly redirecting them to the main application interface.

## 3. Login & Mode Switching

*   **Login**: Returning users hit `POST /api/auth/login` with their email and password.
*   **Rider Auto-Redirect**: When a user with the `rider` role logs in, the `App.tsx` component detects their role and automatically activates `Driver Mode`, fetching their driver profile and switching them to the driver view so they can start working immediately.
*   **Manual Toggle**: Riders can still manually toggle back to passenger mode using the "Switch to Rider / Rider Mode Active" button in the navigation bar if they wish to book a ride for themselves.

## 4. Admin Features & User Management

The application features an exclusive Admin Dashboard for managing the platform.

### Accessing the Dashboard
*   **Role Protection**: Only users with the explicit `admin` role in the database can see the "Admin" button in the navigation bar.
*   **Middleware Protection**: All admin API endpoints are strictly protected by the `requireRole("admin")` middleware on the backend. If a non-admin attempts to access these endpoints, they receive a 403 Forbidden error.

### Admin Capabilities
*   **View All Users (`GET /api/auth/users`)**: Admins can view a complete list of all registered users (passengers, riders, and other admins). Passwords are intentionally omitted from this data payload for security.
*   **Create Users (`POST /api/auth/users`)**: 
    *   Admins can create new accounts directly from the dashboard.
    *   Unlike the public `/register` route, this endpoint does *not* create a session token. This allows admins to rapidly create multiple accounts without getting unexpectedly logged out of their own admin session.
*   **Delete Users (`DELETE /api/auth/users/:id`)**:
    *   Admins can instantly remove users from the platform. 
    *   **Cleanup**: The backend is configured to safely clean up associated data. If an admin deletes a `rider`, their associated profile in the `drivers` table is automatically purged to prevent orphaned data in the ride-hailing system.
    *   **Safety**: The backend actively prevents an admin from accidentally deleting their own currently active account.
