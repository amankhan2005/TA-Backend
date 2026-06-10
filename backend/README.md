# TeacherAttendance — Backend API

Multi-Tenant SaaS School Attendance Management System

**Production domain:** https://teacherattendance.com

## Tech Stack
- Node.js + Express.js
- MongoDB Atlas (Africa region — af-south-1)
- Cloudinary (media storage)
- Resend (transactional email)
- JWT Authentication + RBAC

## Quick Start

```bash
npm install
cp .env.example .env
# Fill in your .env values
node utils/seed.js   # Create super admin + subscription plans
npm run dev
```

## API Endpoints

### Auth (`/api/auth`)
| Method | Path | Role | Description |
|--------|------|------|-------------|
| POST | `/super-admin/login` | Public | Super admin login |
| POST | `/school-admin/login` | Public | School admin login |
| POST | `/teacher/login` | Public | Teacher login |
| POST | `/forgot-password` | Public | Send password reset email |
| POST | `/reset-password` | Public | Reset password via token |
| PUT | `/change-password` | All | Change password in-session |

### Schools (`/api/schools`)
| Method | Path | Role | Description |
|--------|------|------|-------------|
| POST | `/invite` | SuperAdmin | Invite school via email |
| GET | `/` | SuperAdmin | List all schools |
| GET | `/stats` | SuperAdmin | System analytics dashboard |
| GET | `/my-school` | SchoolAdmin | Get own school profile |
| PATCH | `/logo` | SchoolAdmin | Update school logo |
| GET | `/:schoolId` | SuperAdmin | Get single school |
| POST | `/:schoolId/resend-invite` | SuperAdmin | Resend invite email |
| GET | `/:schoolId/attendance` | SuperAdmin | View school's attendance |
| PATCH | `/:schoolId/status` | SuperAdmin | Enable/disable/suspend school |
| PATCH | `/:schoolId/plan` | SuperAdmin | Update subscription plan |
| POST | `/register` | Public | Complete school registration |

### Teachers (`/api/teachers`)
| Method | Path | Role | Description |
|--------|------|------|-------------|
| POST | `/` | SchoolAdmin | Create teacher account |
| GET | `/` | SchoolAdmin | List all teachers |
| GET | `/analytics/:year/:month` | SchoolAdmin | Teacher-wise attendance analytics |
| GET | `/:id` | SchoolAdmin | Get single teacher |
| PUT | `/:id` | SchoolAdmin | Update teacher |
| PATCH | `/:id/reset-password` | SchoolAdmin | Reset teacher password |
| PATCH | `/:id/reset-device` | SchoolAdmin | Reset teacher device session |
| DELETE | `/:id` | SchoolAdmin | Delete teacher |

### Attendance (`/api/attendance`)
| Method | Path | Role | Description |
|--------|------|------|-------------|
| POST | `/wifi` | Teacher | Mark WiFi attendance |
| POST | `/qr` | Teacher | Mark QR attendance (with selfie) |
| GET | `/my-history` | Teacher | View own attendance history |
| POST | `/qr-session` | SchoolAdmin | Generate QR session |
| GET | `/qr-session/active` | SchoolAdmin | Get active QR session |
| GET | `/today` | SchoolAdmin | Today's attendance summary |
| GET | `/daily/:date` | SchoolAdmin | Daily attendance by date |
| GET | `/report/:year/:month` | SchoolAdmin | Monthly attendance report |
| GET | `/suspicious` | SuperAdmin | Suspicious activity logs |

### Settings (`/api/settings`)
| Method | Path | Role | Description |
|--------|------|------|-------------|
| GET | `/` | SchoolAdmin | Get school settings |
| PATCH | `/wifi` | SchoolAdmin | Update WiFi + GPS config |
| PATCH | `/qr` | SchoolAdmin | Update QR expiry |
| PATCH | `/mode` | SchoolAdmin | Toggle WiFi/QR modes |

### Plans (`/api/plans`)
| Method | Path | Role | Description |
|--------|------|------|-------------|
| GET | `/` | Public | List active plans |
| POST | `/` | SuperAdmin | Create plan |
| PUT | `/:id` | SuperAdmin | Update plan |
| DELETE | `/:id` | SuperAdmin | Deactivate plan |

### Audit Logs (`/api/audit`)
| Method | Path | Role | Description |
|--------|------|------|-------------|
| GET | `/system` | SuperAdmin | Full system audit log |
| GET | `/summary` | SuperAdmin | Audit analytics & summary |
| GET | `/actor/:actorId` | SuperAdmin | Single actor history |
| GET | `/school/:schoolId` | SuperAdmin | School-scoped audit logs |
| GET | `/my-school` | SchoolAdmin | Own school audit logs |
| GET | `/my-activity` | SchoolAdmin | Own activity history |
| GET | `/my-logins` | SchoolAdmin | Own login history |


### App Version (`/api/app-version`)
| Method | Path | Role | Description |
|--------|------|------|-------------|
| GET | `/` | Public | Get active version config (mobile app startup check) |
| GET | `/history` | SuperAdmin | List all version records |
| POST | `/` | SuperAdmin | Create new version config (auto-deactivates previous) |
| PUT | `/:id` | SuperAdmin | Update a version config |
| PATCH | `/:id/activate` | SuperAdmin | Set a historical record as active |
| DELETE | `/:id` | SuperAdmin | Delete a non-active record |

## Environment Variables

See `.env.example` for all required variables.

## Default Credentials (after `npm run seed`)

 

> ⚠️ Change the Super Admin password immediately after first login.

## URLs

| Environment | Super Admin | School Admin |
|-------------|-------------|--------------|
| Production | https://superadmin.teacherattendance.com | https://admin.teacherattendance.com |

## Security
- JWT auth with 24h expiry
- RBAC: superAdmin / schoolAdmin / teacher roles
- schoolId isolation on every query
- Rate limiting: 100 req/min global, 10 req/15min on auth endpoints
- bcrypt password hashing (12 rounds)
- VPN + Mock GPS detection (client-reported, app-enforced)
- Duplicate attendance prevention
- Device session validation
- Immutable audit logs with 365-day TTL auto-expiry
