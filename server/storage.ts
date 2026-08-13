import { db } from "./db";
import {
  users, admins, vehicleCategories, zones, tripRequests, transactions,
  businessSettings, tripFares, couponSetups, reviews, driverDetails,
  cancellationReasons, blogs, withdrawRequests,
  type User, type Admin, type VehicleCategory, type Zone, type TripRequest,
  type Transaction, type BusinessSetting, type TripFare, type CouponSetup,
  type Review, type DriverDetail, type CancellationReason, type Blog, type WithdrawRequest,
  type InsertUser, type InsertTripRequest
} from "@shared/schema";
import { eq, desc, count, sum, gte, and, ilike, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

const driverUser = alias(users, "driver_user");

export interface IStorage {
  // Auth
  getAdminByEmail(email: string): Promise<Admin | undefined>;
  // Users
  getUsers(
    userType?: string,
    search?: string,
    page?: number,
    limit?: number,
    isActive?: boolean,
    verificationStatus?: string,
  ): Promise<{ data: User[]; total: number }>;
  getUserById(id: string): Promise<User | undefined>;
  updateUserStatus(id: string, isActive: boolean): Promise<User>;
  updateUser(id: string, data: Partial<User>): Promise<User>;
  // Trips
  getTrips(status?: string, search?: string, page?: number, limit?: number, type?: string): Promise<{ data: any[]; total: number }>;
  getTripById(id: string): Promise<TripRequest | undefined>;
  updateTripStatus(id: string, status: string): Promise<TripRequest>;
  // Vehicle Categories
  getVehicleCategories(): Promise<VehicleCategory[]>;
  createVehicleCategory(data: Partial<VehicleCategory>): Promise<VehicleCategory>;
  updateVehicleCategory(id: string, data: Partial<VehicleCategory>): Promise<VehicleCategory>;
  deleteVehicleCategory(id: string): Promise<void>;
  // Zones
  getZones(): Promise<Zone[]>;
  createZone(data: Partial<Zone>): Promise<Zone>;
  updateZone(id: string, data: Partial<Zone>): Promise<Zone>;
  deleteZone(id: string): Promise<void>;
  // Fares
  getTripFares(): Promise<any[]>;
  upsertTripFare(data: Partial<TripFare>): Promise<TripFare>;
  updateTripFare(id: string, data: Partial<TripFare>): Promise<TripFare>;
  deleteTripFare(id: string): Promise<void>;
  // Transactions
  getTransactions(userId?: string, page?: number, limit?: number): Promise<{ data: any[]; total: number }>;
  // Coupons
  getCoupons(): Promise<CouponSetup[]>;
  createCoupon(data: Partial<CouponSetup>): Promise<CouponSetup>;
  updateCoupon(id: string, data: Partial<CouponSetup>): Promise<CouponSetup>;
  deleteCoupon(id: string): Promise<void>;
  // Reviews
  getReviews(page?: number, limit?: number): Promise<{ data: any[]; total: number }>;
  // Business Settings
  getBusinessSettings(): Promise<BusinessSetting[]>;
  upsertBusinessSetting(keyName: string, value: string, type: string): Promise<BusinessSetting>;
  // Blogs
  getBlogs(): Promise<Blog[]>;
  createBlog(data: Partial<Blog>): Promise<Blog>;
  updateBlog(id: string, data: Partial<Blog>): Promise<Blog>;
  deleteBlog(id: string): Promise<void>;
  // Withdraw Requests
  getWithdrawRequests(status?: string): Promise<any[]>;
  // Dashboard stats
  getDashboardStats(): Promise<any>;
  // Cancellation reasons
  getCancellationReasons(): Promise<CancellationReason[]>;
  createCancellationReason(data: Partial<CancellationReason>): Promise<CancellationReason>;
  deleteCancellationReason(id: string): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  async getAdminByEmail(email: string): Promise<Admin | undefined> {
    const [admin] = await db.select().from(admins).where(eq(admins.email, email));
    return admin;
  }

  async getUsers(
    userType?: string,
    search?: string,
    page = 1,
    limit = 15,
    isActive?: boolean,
    verificationStatus?: string,
  ): Promise<{ data: User[]; total: number }> {
    const offset = (page - 1) * limit;
    let query = db.select().from(users);
    const conditions = [];
    if (userType) conditions.push(eq(users.userType, userType));
    if (typeof isActive === "boolean") conditions.push(eq(users.isActive, isActive));
    if (verificationStatus && verificationStatus !== "all") {
      conditions.push(eq(users.verificationStatus, verificationStatus));
    }
    if (search) conditions.push(or(
      ilike(users.fullName, `%${search}%`),
      ilike(users.email, `%${search}%`),
      ilike(users.phone, `%${search}%`)
    ));
    if (conditions.length) query = query.where(and(...conditions)) as any;
    const data = await (query as any).orderBy(desc(users.createdAt)).limit(limit).offset(offset);
    const [{ total }] = await db.select({ total: count() }).from(users).where(conditions.length ? and(...conditions) : undefined as any);
    return { data, total: Number(total) };
  }

  async getUserById(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async updateUserStatus(id: string, isActive: boolean): Promise<User> {
    const [updated] = await db.update(users).set({ isActive }).where(eq(users.id, id)).returning();
    return updated;
  }

  async updateUser(id: string, data: Partial<User>): Promise<User> {
    const [updated] = await db.update(users).set(data as any).where(eq(users.id, id)).returning();
    return updated;
  }

  async getTrips(status?: string, search?: string, page = 1, limit = 15, type?: string): Promise<{ data: any[]; total: number }> {
    const offset = (page - 1) * limit;
    const conditions: any[] = [];
    if (status && status !== "all") conditions.push(eq(tripRequests.currentStatus, status));
    if (type && type !== "all") {
      if (type === "parcel") {
        conditions.push(or(eq(tripRequests.type, "parcel"), ilike(tripRequests.tripType, "%parcel%")));
      } else {
        conditions.push(or(eq(tripRequests.type, "ride"), eq(tripRequests.tripType, "ride"), eq(tripRequests.tripType, "normal")));
      }
    }
    if (search) {
      const term = `%${search}%`;
      conditions.push(or(
        ilike(tripRequests.refId, term),
        ilike(users.fullName, term),
        ilike(users.phone, term),
        ilike(driverUser.fullName, term),
        ilike(driverUser.phone, term),
      ));
    }

    const whereClause = conditions.length ? and(...conditions) : undefined;

    const data = await db.select({
      trip: tripRequests,
      customer: { fullName: users.fullName, phone: users.phone, email: users.email },
      driver: { fullName: driverUser.fullName, phone: driverUser.phone },
      vehicleCategory: { name: vehicleCategories.name },
      zone: { name: zones.name },
    })
      .from(tripRequests)
      .leftJoin(users, eq(tripRequests.customerId, users.id))
      .leftJoin(driverUser, eq(tripRequests.driverId, driverUser.id))
      .leftJoin(vehicleCategories, eq(tripRequests.vehicleCategoryId, vehicleCategories.id))
      .leftJoin(zones, eq(tripRequests.zoneId, zones.id))
      .where(whereClause as any)
      .orderBy(desc(tripRequests.createdAt))
      .limit(limit).offset(offset);

    const countQuery = db.select({ total: count() })
      .from(tripRequests)
      .leftJoin(users, eq(tripRequests.customerId, users.id))
      .leftJoin(driverUser, eq(tripRequests.driverId, driverUser.id));
    const [{ total }] = await (whereClause
      ? countQuery.where(whereClause as any)
      : countQuery);
    return { data, total: Number(total) };
  }

  async getTripById(id: string): Promise<TripRequest | undefined> {
    const [trip] = await db.select().from(tripRequests).where(eq(tripRequests.id, id));
    return trip;
  }

  async updateTripStatus(id: string, status: string): Promise<TripRequest> {
    const [updated] = await db.update(tripRequests).set({ currentStatus: status, updatedAt: new Date() })
      .where(eq(tripRequests.id, id)).returning();
    return updated;
  }

  async getVehicleCategories(): Promise<VehicleCategory[]> {
    return db.select().from(vehicleCategories).orderBy(vehicleCategories.name);
  }

  async createVehicleCategory(data: Partial<VehicleCategory>): Promise<VehicleCategory> {
    const [created] = await db.insert(vehicleCategories).values(data as any).returning();
    return created;
  }

  async updateVehicleCategory(id: string, data: Partial<VehicleCategory>): Promise<VehicleCategory> {
    const [updated] = await db.update(vehicleCategories).set(data as any).where(eq(vehicleCategories.id, id)).returning();
    return updated;
  }

  async deleteVehicleCategory(id: string): Promise<void> {
    await db.delete(vehicleCategories).where(eq(vehicleCategories.id, id));
  }

  private mapZoneRow(row: any): Zone {
    return {
      id: String(row.id),
      name: String(row.name || ""),
      coordinates: row.coordinates ?? null,
      latitude: row.latitude != null ? Number(row.latitude) : null,
      longitude: row.longitude != null ? Number(row.longitude) : null,
      radiusKm: row.radius_km != null ? Number(row.radius_km) : 5,
      serviceType: String(row.service_type || "both"),
      surgeFactor: row.surge_factor != null ? Number(row.surge_factor) : 1,
      isActive: row.is_active !== false,
      createdAt: row.created_at ? new Date(row.created_at) : null,
    } as Zone;
  }

  async getZones(): Promise<Zone[]> {
    const result = await db.execute(sql`
      SELECT id, name, coordinates, latitude, longitude, radius_km, service_type, surge_factor, is_active, created_at
      FROM zones
      ORDER BY name
    `);
    return (result.rows as any[]).map((row) => this.mapZoneRow(row));
  }

  async createZone(data: Partial<Zone>): Promise<Zone> {
    const body = data as any;
    const result = await db.execute(sql`
      INSERT INTO zones (name, coordinates, latitude, longitude, radius_km, service_type, surge_factor, is_active)
      VALUES (
        ${String(body.name || "").trim()},
        ${body.coordinates ?? null},
        ${body.latitude ?? null},
        ${body.longitude ?? null},
        ${body.radiusKm ?? body.radius_km ?? 5},
        ${body.serviceType ?? body.service_type ?? "both"},
        ${body.surgeFactor ?? body.surge_factor ?? 1},
        ${body.isActive !== undefined ? !!body.isActive : true}
      )
      RETURNING id, name, coordinates, latitude, longitude, radius_km, service_type, surge_factor, is_active, created_at
    `);
    return this.mapZoneRow(result.rows[0]);
  }

  async updateZone(id: string, data: Partial<Zone>): Promise<Zone> {
    const body = data as any;
    const result = await db.execute(sql`
      UPDATE zones
      SET
        name = COALESCE(${body.name != null ? String(body.name).trim() : null}, name),
        coordinates = COALESCE(${body.coordinates !== undefined ? body.coordinates : null}, coordinates),
        latitude = COALESCE(${body.latitude !== undefined ? body.latitude : null}, latitude),
        longitude = COALESCE(${body.longitude !== undefined ? body.longitude : null}, longitude),
        radius_km = COALESCE(${body.radiusKm !== undefined ? body.radiusKm : (body.radius_km !== undefined ? body.radius_km : null)}, radius_km),
        service_type = COALESCE(${body.serviceType ?? body.service_type ?? null}, service_type),
        surge_factor = COALESCE(${body.surgeFactor !== undefined ? body.surgeFactor : (body.surge_factor !== undefined ? body.surge_factor : null)}, surge_factor),
        is_active = COALESCE(${body.isActive !== undefined ? !!body.isActive : null}, is_active)
      WHERE id = ${id}::uuid
      RETURNING id, name, coordinates, latitude, longitude, radius_km, service_type, surge_factor, is_active, created_at
    `);
    if (!result.rows.length) throw new Error("Zone not found");
    return this.mapZoneRow(result.rows[0]);
  }

  async deleteZone(id: string): Promise<void> {
    await db.execute(sql`DELETE FROM zones WHERE id = ${id}::uuid`);
  }

  async getTripFares(): Promise<any[]> {
    return db.select({
      fare: tripFares,
      zone: { id: zones.id, name: zones.name },
      vehicleCategory: { id: vehicleCategories.id, name: vehicleCategories.name },
    })
      .from(tripFares)
      .leftJoin(zones, eq(tripFares.zoneId, zones.id))
      .leftJoin(vehicleCategories, eq(tripFares.vehicleCategoryId, vehicleCategories.id));
  }

  async upsertTripFare(data: Partial<TripFare>): Promise<TripFare> {
    const [created] = await db.insert(tripFares).values(data as any).returning();
    return created;
  }

  async updateTripFare(id: string, data: Partial<TripFare>): Promise<TripFare> {
    const [updated] = await db.update(tripFares).set(data as any).where(eq(tripFares.id, id)).returning();
    return updated;
  }

  async deleteTripFare(id: string): Promise<void> {
    await db.delete(tripFares).where(eq(tripFares.id, id));
  }

  async getTransactions(userId?: string, page = 1, limit = 15): Promise<{ data: any[]; total: number }> {
    const offset = (page - 1) * limit;
    const conditions: any[] = [];
    if (userId) conditions.push(eq(transactions.userId, userId));

    const data = await db.select({
      transaction: transactions,
      user: { fullName: users.fullName, email: users.email, phone: users.phone },
    })
      .from(transactions)
      .leftJoin(users, eq(transactions.userId, users.id))
      .where(conditions.length ? and(...conditions) : undefined as any)
      .orderBy(desc(transactions.createdAt))
      .limit(limit).offset(offset);

    const [{ total }] = await db.select({ total: count() }).from(transactions)
      .where(conditions.length ? and(...conditions) : undefined as any);
    return { data, total: Number(total) };
  }

  async getCoupons(): Promise<CouponSetup[]> {
    return db.select().from(couponSetups).orderBy(desc(couponSetups.createdAt));
  }

  async createCoupon(data: Partial<CouponSetup>): Promise<CouponSetup> {
    const [created] = await db.insert(couponSetups).values(data as any).returning();
    return created;
  }

  async updateCoupon(id: string, data: Partial<CouponSetup>): Promise<CouponSetup> {
    const [updated] = await db.update(couponSetups).set(data as any).where(eq(couponSetups.id, id)).returning();
    return updated;
  }

  async deleteCoupon(id: string): Promise<void> {
    await db.delete(couponSetups).where(eq(couponSetups.id, id));
  }

  async getReviews(page = 1, limit = 15): Promise<{ data: any[]; total: number }> {
    const offset = (page - 1) * limit;
    const data = await db.select({
      review: reviews,
      reviewer: { fullName: users.fullName },
    })
      .from(reviews)
      .leftJoin(users, eq(reviews.reviewerId, users.id))
      .orderBy(desc(reviews.createdAt))
      .limit(limit).offset(offset);
    const [{ total }] = await db.select({ total: count() }).from(reviews);
    return { data, total: Number(total) };
  }

  async getBusinessSettings(): Promise<BusinessSetting[]> {
    return db.select().from(businessSettings).orderBy(businessSettings.settingsType, businessSettings.keyName);
  }

  async upsertBusinessSetting(keyName: string, value: string, type: string): Promise<BusinessSetting> {
    const [result] = await db.insert(businessSettings)
      .values({ keyName, value, settingsType: type, updatedAt: new Date() })
      .onConflictDoUpdate({ target: businessSettings.keyName, set: { value, updatedAt: new Date() } })
      .returning();
    return result;
  }

  async getBlogs(): Promise<Blog[]> {
    return db.select().from(blogs).orderBy(desc(blogs.createdAt));
  }

  async createBlog(data: Partial<Blog>): Promise<Blog> {
    const [created] = await db.insert(blogs).values(data as any).returning();
    return created;
  }

  async updateBlog(id: string, data: Partial<Blog>): Promise<Blog> {
    const [updated] = await db.update(blogs).set(data as any).where(eq(blogs.id, id)).returning();
    return updated;
  }

  async deleteBlog(id: string): Promise<void> {
    await db.delete(blogs).where(eq(blogs.id, id));
  }

  async getWithdrawRequests(status?: string): Promise<any[]> {
    const conditions: any[] = [];
    if (status) conditions.push(eq(withdrawRequests.status, status));
    return db.select({
      withdraw: withdrawRequests,
      user: { fullName: users.fullName, email: users.email, phone: users.phone },
    })
      .from(withdrawRequests)
      .leftJoin(users, eq(withdrawRequests.userId, users.id))
      .where(conditions.length ? and(...conditions) : undefined as any)
      .orderBy(desc(withdrawRequests.createdAt));
  }

  async getDashboardStats(): Promise<any> {
    const safe = async <T>(fn: () => Promise<T>, fallback: T): Promise<T> => {
      try { return await fn(); } catch (_) { return fallback; }
    };

    const [totalCustomers] = await safe(() => db.select({ count: count() }).from(users).where(eq(users.userType, 'customer')), [{ count: 0 }]);
    const [totalDrivers]   = await safe(() => db.select({ count: count() }).from(users).where(eq(users.userType, 'driver')), [{ count: 0 }]);
    const [totalTrips]     = await safe(() => db.select({ count: count() }).from(tripRequests), [{ count: 0 }]);
    const [completedTrips] = await safe(() => db.select({ count: count() }).from(tripRequests).where(eq(tripRequests.currentStatus, 'completed')), [{ count: 0 }]);
    const [cancelledTrips] = await safe(() => db.select({ count: count() }).from(tripRequests).where(eq(tripRequests.currentStatus, 'cancelled')), [{ count: 0 }]);
    const [ongoingTrips]   = await safe(() => db.select({ count: count() }).from(tripRequests).where(eq(tripRequests.currentStatus, 'ongoing')), [{ count: 0 }]);
    const [totalRevenue]   = await safe(() => db.select({ total: sum(tripRequests.actualFare) }).from(tripRequests).where(eq(tripRequests.currentStatus, 'completed')), [{ total: "0" }]);
    const [txRevenue]      = await safe(() => db.select({ total: sum(transactions.debit) }).from(transactions).where(eq(transactions.transactionType, 'ride_payment') as any), [{ total: "0" }]);
    const [pendingWithdrawals] = await safe(() => db.select({ count: count() }).from(withdrawRequests).where(eq(withdrawRequests.status, 'pending')), [{ count: 0 }]);
    const [totalReviews]   = await safe(() => db.select({ count: count() }).from(reviews), [{ count: 0 }]);
    const [totalZones]     = await safe(() => db.select({ count: count() }).from(zones).where(eq(zones.isActive, true)), [{ count: 0 }]);
    const [totalVehicleCategories] = await safe(() => db.select({ count: count() }).from(vehicleCategories).where(eq(vehicleCategories.isActive, true)), [{ count: 0 }]);

    const recentTrips = await safe(() => db.select({
      id: tripRequests.id,
      refId: tripRequests.refId,
      currentStatus: tripRequests.currentStatus,
      estimatedFare: tripRequests.estimatedFare,
      actualFare: tripRequests.actualFare,
      tripType: tripRequests.tripType,
      pickupAddress: tripRequests.pickupAddress,
      destinationAddress: tripRequests.destinationAddress,
      createdAt: tripRequests.createdAt,
      customerName: users.fullName,
      vehicleCategoryName: vehicleCategories.name,
    })
      .from(tripRequests)
      .leftJoin(users, eq(tripRequests.customerId, users.id))
      .leftJoin(vehicleCategories, eq(tripRequests.vehicleCategoryId, vehicleCategories.id))
      .orderBy(desc(tripRequests.createdAt))
      .limit(10), []);

    const tripRev = Number(totalRevenue.total || 0);
    const txRev = Number(txRevenue?.total || 0);
    return {
      totalCustomers: Number(totalCustomers.count),
      totalDrivers: Number(totalDrivers.count),
      totalTrips: Number(totalTrips.count),
      completedTrips: Number(completedTrips.count),
      cancelledTrips: Number(cancelledTrips.count),
      ongoingTrips: Number(ongoingTrips.count),
      totalRevenue: tripRev + txRev,
      pendingWithdrawals: Number(pendingWithdrawals.count),
      totalReviews: Number(totalReviews.count),
      totalZones: Number(totalZones.count),
      totalVehicleCategories: Number(totalVehicleCategories.count),
      recentTrips,
    };
  }

  async getCancellationReasons(): Promise<CancellationReason[]> {
    return db.select().from(cancellationReasons).orderBy(cancellationReasons.userType, cancellationReasons.reason);
  }

  async createCancellationReason(data: Partial<CancellationReason>): Promise<CancellationReason> {
    const [created] = await db.insert(cancellationReasons).values(data as any).returning();
    return created;
  }

  async deleteCancellationReason(id: string): Promise<void> {
    await db.delete(cancellationReasons).where(eq(cancellationReasons.id, id));
  }
}

export const storage = new DatabaseStorage();
