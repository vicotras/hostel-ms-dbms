# Hostel Management Database Schema

This document describes the Oracle tables and column formats used by the project. `PK` means primary key, `FK` means foreign key, and `UQ` means unique. Unless marked nullable, columns listed as `NOT NULL` must have a value. Oracle `DATE` stores both a calendar date and a time of day.


## HOSTEL

| Column | Oracle type | Null? | Key / rule |
|---|---|---:|---|
| `HOSTEL_ID` | `NUMBER(5,0)` | No | PK |
| `HOSTEL_NAME` | `VARCHAR2(50)` | No | UQ |
| `HOSTEL_TYPE` | `VARCHAR2(10)` | No | `BOYS` or `GIRLS` |
| `CAPACITY` | `NUMBER(4,0)` | No | Must be greater than 0 |
| `LOCATION` | `VARCHAR2(100)` | Yes | — |

## WARDEN

| Column | Oracle type | Null? | Key / rule |
|---|---|---:|---|
| `WARDEN_ID` | `NUMBER(5,0)` | No | PK |
| `WARDEN_NAME` | `VARCHAR2(100)` | No | — |
| `PHONE` | `VARCHAR2(15)` | No | UQ |
| `EMAIL` | `VARCHAR2(100)` | Yes | UQ |
| `HOSTEL_ID` | `NUMBER(5,0)` | No | FK → `HOSTEL.HOSTEL_ID` |

## ROOM

| Column | Oracle type | Null? | Key / rule |
|---|---|---:|---|
| `ROOM_ID` | `NUMBER(6,0)` | No | PK |
| `HOSTEL_ID` | `NUMBER(5,0)` | No | FK → `HOSTEL.HOSTEL_ID` |
| `ROOM_NUMBER` | `VARCHAR2(10)` | No | UQ with `HOSTEL_ID` |
| `ROOM_TYPE` | `VARCHAR2(15)` | No | `AC` or `NON-AC` |
| `CAPACITY` | `NUMBER(2,0)` | No | Must be 1–4 |
| `FLOOR_NUMBER` | `NUMBER(2,0)` | Yes | If supplied, must be 0 or greater |

## STUDENT

| Column | Oracle type | Null? | Key / rule |
|---|---|---:|---|
| `STUDENT_ID` | `NUMBER(10,0)` | No | PK |
| `REGISTRATION_NO` | `VARCHAR2(20)` | No | UQ |
| `STUDENT_NAME` | `VARCHAR2(100)` | No | — |
| `GENDER` | `VARCHAR2(10)` | No | `MALE` or `FEMALE` |
| `DATE_OF_BIRTH` | `DATE` | Yes | — |
| `PHONE` | `VARCHAR2(15)` | No | UQ |
| `EMAIL` | `VARCHAR2(100)` | No | UQ |
| `DEPARTMENT` | `VARCHAR2(100)` | No | — |
| `YEAR_OF_STUDY` | `NUMBER(1,0)` | No | Must be 1–5 |
| `ADDRESS` | `VARCHAR2(200)` | Yes | — |

## ROOM_ALLOCATION

| Column | Oracle type | Null? | Key / rule |
|---|---|---:|---|
| `ALLOCATION_ID` | `NUMBER(8,0)` | No | PK |
| `STUDENT_ID` | `NUMBER(10,0)` | No | FK → `STUDENT.STUDENT_ID` |
| `ROOM_ID` | `NUMBER(6,0)` | No | FK → `ROOM.ROOM_ID` |
| `ALLOCATION_DATE` | `DATE` | No | Defaults to `SYSDATE` |
| `VACATE_DATE` | `DATE` | Yes | Must be on/after allocation date when supplied |
| `STATUS` | `VARCHAR2(15)` | No | Defaults to `ACTIVE`; `ACTIVE` or `VACATED` |

## COMPLAINT

This table is for hostel maintenance/facility complaints.

| Column | Oracle type | Null? | Key / rule |
|---|---|---:|---|
| `COMPLAINT_ID` | `NUMBER(8,0)` | No | PK |
| `STUDENT_ID` | `NUMBER(10,0)` | No | FK → `STUDENT.STUDENT_ID` |
| `COMPLAINT_TYPE` | `VARCHAR2(30)` | No | `ELECTRICAL`, `PLUMBING`, `CLEANING`, `INTERNET`, `ROOM`, `MESS`, or `OTHER` |
| `DESCRIPTION` | `VARCHAR2(500)` | No | — |
| `COMPLAINT_DATE` | `DATE` | No | Defaults to `SYSDATE` |
| `STATUS` | `VARCHAR2(20)` | No | Defaults to `PENDING`; `PENDING`, `IN PROGRESS`, `RESOLVED`, or `REJECTED` |
| `RESOLUTION` | `VARCHAR2(500)` | Yes | — |
| `RESOLVED_DATE` | `DATE` | Yes | — |

## STUDENT_COMPLAINT

This separate table stores reports made against a hosteller. `ACCUSED_STUDENT_ID` is the student the report concerns; `REPORTER_STUDENT_ID` is optional.

| Column | Oracle type | Null? | Key / rule |
|---|---|---:|---|
| `COMPLAINT_ID` | `NUMBER(8,0)` | No | PK |
| `ACCUSED_STUDENT_ID` | `NUMBER(10,0)` | No | FK → `STUDENT.STUDENT_ID` |
| `COMPLAINT_TYPE` | `VARCHAR2(30)` | No | — |
| `DESCRIPTION` | `VARCHAR2(500)` | No | — |
| `COMPLAINT_DATE` | `DATE` | No | Defaults to `SYSDATE` |
| `REPORTED_BY` | `VARCHAR2(100)` | Yes | Name/text for a staff-entered report |
| `STATUS` | `VARCHAR2(20)` | No | Defaults to `PENDING`; `PENDING`, `IN PROGRESS`, `RESOLVED`, or `DISMISSED` |
| `RESOLUTION` | `VARCHAR2(500)` | Yes | — |
| `RESOLVED_DATE` | `DATE` | Yes | — |
| `REPORTER_STUDENT_ID` | `NUMBER(10,0)` | Yes | FK → `STUDENT.STUDENT_ID` |

## LEAVE_REQUEST

| Column | Oracle type | Null? | Key / rule |
|---|---|---:|---|
| `LEAVE_ID` | `NUMBER(8,0)` | No | PK |
| `STUDENT_ID` | `NUMBER(10,0)` | No | FK → `STUDENT.STUDENT_ID` |
| `FROM_DATE` | `DATE` | No | — |
| `TO_DATE` | `DATE` | No | Must be on/after `FROM_DATE` |
| `REASON` | `VARCHAR2(500)` | No | — |
| `STATUS` | `VARCHAR2(15)` | No | Defaults to `PENDING`; `PENDING`, `APPROVED`, or `REJECTED` |
| `APPLIED_DATE` | `DATE` | No | Defaults to `SYSDATE` |
| `REMARKS` | `VARCHAR2(500)` | Yes | — |

## VISITOR

| Column | Oracle type | Null? | Key / rule |
|---|---|---:|---|
| `VISITOR_ID` | `NUMBER(8,0)` | No | PK |
| `STUDENT_ID` | `NUMBER(10,0)` | No | FK → `STUDENT.STUDENT_ID` |
| `VISITOR_NAME` | `VARCHAR2(100)` | No | — |
| `RELATIONSHIP` | `VARCHAR2(30)` | Yes | — |
| `PHONE` | `VARCHAR2(15)` | Yes | — |
| `VISIT_DATE` | `DATE` | No | Defaults to `SYSDATE` |
| `IN_TIME` | `VARCHAR2(10)` | Yes | Time text entered by the user |
| `OUT_TIME` | `VARCHAR2(10)` | Yes | Time text entered by the user |
| `PURPOSE` | `VARCHAR2(200)` | Yes | — |

## APP_ACCOUNT

This table stores salted password hashes. It does not store plaintext passwords.

| Column | Oracle type | Null? | Key / rule |
|---|---|---:|---|
| `ACCOUNT_ID` | `NUMBER(8,0)` | No | PK |
| `USERNAME` | `VARCHAR2(50)` | No | UQ |
| `PASSWORD_SALT` | `VARCHAR2(32)` | No | — |
| `PASSWORD_HASH` | `VARCHAR2(128)` | No | — |
| `ROLE` | `VARCHAR2(10)` | No | `ADMIN`, `WARDEN`, or `STUDENT` |
| `IS_ACTIVE` | `CHAR(1)` | No | Defaults to `Y`; `Y` or `N` |
| `CREATED_AT` | `DATE` | No | Defaults to `SYSDATE` |
| `STUDENT_ID` | `NUMBER(10,0)` | Yes | Unique FK → `STUDENT.STUDENT_ID`; required for student accounts and null for admin/warden accounts |
| `MUST_CHANGE_PASSWORD` | `CHAR(1)` | No | Defaults to `N`; `Y` or `N` |

## Relationships at a glance

- One `HOSTEL` has many `ROOM` and `WARDEN` rows.
- `ROOM_ALLOCATION` links students and rooms and records allocation history.
- A student can have many maintenance complaints, student reports, leave requests, and visitor records.
- A student report has one accused student and may have a reporting student.
- An `APP_ACCOUNT` may link to one student; admin and warden accounts have no student link.

For the exact Oracle DDL, see [`../sql/create_hostel_schema.sql`](../sql/create_hostel_schema.sql). The schema export from Oracle is in [`../sql/hostel_schema_export.sql`](../sql/hostel_schema_export.sql).
