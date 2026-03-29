import { prisma } from '../utils/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { Prisma } from '@prisma/client';
import { generateQuoteAIContent } from './quote-ai.service.js';

interface ListQuotesFilters {
  status?: string;
  search?: string;
  page?: number;
  limit?: number;
}

export async function listQuotes(filters: ListQuotesFilters) {
  const page = filters.page || 1;
  const limit = filters.limit || 20;

  const where: Prisma.QuoteWhereInput = {
    ...(filters.status && { status: filters.status as any }),
    ...(filters.search && {
      OR: [
        { quoteNumber: { contains: filters.search, mode: 'insensitive' as const } },
        { institutionName: { contains: filters.search, mode: 'insensitive' as const } },
        { contactName: { contains: filters.search, mode: 'insensitive' as const } },
      ],
    }),
  };

  const [quotes, total] = await Promise.all([
    prisma.quote.findMany({
      where,
      include: {
        branch: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true, email: true } },
        _count: { select: { items: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.quote.count({ where }),
  ]);

  const totalPages = Math.ceil(total / limit);
  return {
    data: quotes,
    pagination: {
      page,
      limit,
      total,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1,
    },
  };
}

export async function getQuoteById(id: string) {
  const quote = await prisma.quote.findUnique({
    where: { id },
    include: {
      items: { orderBy: { sortOrder: 'asc' } },
      branch: { select: { id: true, name: true } },
      customer: { select: { id: true, name: true, phone: true, email: true } },
      createdBy: { select: { id: true, name: true, email: true } },
      order: { select: { id: true, orderNumber: true, status: true } },
    },
  });

  if (!quote) {
    throw new AppError(404, 'Quote not found');
  }

  return quote;
}

async function generateQuoteNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `QT-${year}-`;

  const lastQuote = await prisma.quote.findFirst({
    where: { quoteNumber: { startsWith: prefix } },
    orderBy: { quoteNumber: 'desc' },
    select: { quoteNumber: true },
  });

  let nextNum = 1;
  if (lastQuote) {
    const lastNum = parseInt(lastQuote.quoteNumber.split('-').pop() || '0', 10);
    nextNum = lastNum + 1;
  }

  return `${prefix}${String(nextNum).padStart(3, '0')}`;
}

interface QuoteItemInput {
  id?: string;
  courseId?: string;
  courseName?: string;
  description?: string;
  groups?: number;
  groupsCount?: number;
  meetingsPerGroup: number;
  pricePerMeeting: number;
  meetingDuration?: number;
  durationMinutes?: number;
  sortOrder?: number;
}

export async function createQuote(data: {
  branchId?: string;
  institutionName: string;
  contactName: string;
  contactPhone?: string;
  contactEmail?: string;
  contactRole?: string;
  clientType?: string;
  customerId?: string;
  payingBodyName?: string;
  payingBodyPhone?: string;
  payingBodyEmail?: string;
  payingBodyNotes?: string;
  includesVat?: boolean;
  cancellationTerms?: string;
  paymentTerms?: string;
  validUntil?: string;
  discount?: number;
  notes?: string;
  content?: any;
  generatedContent?: string;
  items?: QuoteItemInput[];
  createdById: string;
}) {
  const { items, generatedContent, ...quoteData } = data;
  // Accept generatedContent as content
  if (generatedContent && !quoteData.content) {
    quoteData.content = generatedContent;
  }

  // Auto-create branch/customer if new name provided without existing ID
  if (!quoteData.branchId && quoteData.institutionName && quoteData.clientType === 'institutional') {
    const existing = await prisma.branch.findFirst({
      where: { name: { equals: quoteData.institutionName, mode: 'insensitive' } }
    });
    if (existing) {
      quoteData.branchId = existing.id;
    } else {
      const newBranch = await prisma.branch.create({
        data: {
          name: quoteData.institutionName,
          type: 'frontal',
          contactName: quoteData.contactName || undefined,
          contactPhone: quoteData.contactPhone || undefined,
          contactEmail: quoteData.contactEmail || undefined,
        }
      });
      quoteData.branchId = newBranch.id;
    }
  }

  if (!quoteData.customerId && quoteData.institutionName && quoteData.clientType === 'private') {
    const existing = await prisma.customer.findFirst({
      where: { name: { equals: quoteData.institutionName, mode: 'insensitive' } }
    });
    if (existing) {
      quoteData.customerId = existing.id;
    } else {
      const newCustomer = await prisma.customer.create({
        data: {
          name: quoteData.institutionName,
          phone: quoteData.contactPhone || '',
          email: quoteData.contactEmail || undefined,
        }
      });
      quoteData.customerId = newCustomer.id;
    }
  }

  const quote = await prisma.$transaction(async (tx) => {
    const quoteNumber = await generateQuoteNumber();

    // Calculate totals
    let totalAmount = 0;
    const itemsCreate = items?.map((item, idx) => {
      const groups = item.groups || item.groupsCount || 1;
      const duration = item.meetingDuration || item.durationMinutes || 90;
      const subtotal = groups * item.meetingsPerGroup * item.pricePerMeeting;
      totalAmount += subtotal;
      return {
        courseId: item.courseId || undefined,
        courseName: item.courseName || '',
        description: item.description || undefined,
        groups,
        meetingsPerGroup: item.meetingsPerGroup,
        pricePerMeeting: item.pricePerMeeting,
        meetingDuration: duration,
        subtotal,
        sortOrder: item.sortOrder ?? idx,
      };
    });

    const discount = quoteData.discount || 0;
    const finalAmount = totalAmount - discount;

    const created = await tx.quote.create({
      data: {
        quoteNumber,
        branchId: quoteData.branchId || undefined,
        institutionName: quoteData.institutionName,
        contactName: quoteData.contactName,
        contactPhone: quoteData.contactPhone || '',
        contactEmail: quoteData.contactEmail || undefined,
        contactRole: quoteData.contactRole || undefined,
        clientType: quoteData.clientType as any || undefined,
        customerId: quoteData.customerId || undefined,
        payingBodyName: quoteData.payingBodyName || undefined,
        payingBodyPhone: quoteData.payingBodyPhone || undefined,
        payingBodyEmail: quoteData.payingBodyEmail || undefined,
        payingBodyNotes: quoteData.payingBodyNotes || undefined,
        includesVat: quoteData.includesVat || false,
        cancellationTerms: quoteData.cancellationTerms || undefined,
        paymentTerms: quoteData.paymentTerms || undefined,
        content: quoteData.content || undefined,
        totalAmount,
        discount,
        finalAmount,
        validUntil: quoteData.validUntil ? new Date(quoteData.validUntil) : undefined,
        notes: quoteData.notes || undefined,
        status: 'draft',
        createdById: quoteData.createdById,
        items: itemsCreate && itemsCreate.length > 0 ? { create: itemsCreate } : undefined,
      },
      include: {
        items: { orderBy: { sortOrder: 'asc' } },
        branch: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true, email: true } },
      },
    });

    return created;
  });

  return quote;
}

export async function updateQuote(id: string, data: {
  branchId?: string;
  institutionName?: string;
  contactName?: string;
  contactPhone?: string;
  contactEmail?: string;
  contactRole?: string;
  clientType?: string;
  customerId?: string;
  payingBodyName?: string;
  payingBodyPhone?: string;
  payingBodyEmail?: string;
  payingBodyNotes?: string;
  includesVat?: boolean;
  cancellationTerms?: string;
  paymentTerms?: string;
  validUntil?: string;
  discount?: number;
  notes?: string;
  content?: any;
  status?: string;
  items?: QuoteItemInput[];
}) {
  const existing = await prisma.quote.findUnique({ where: { id } });
  if (!existing) {
    throw new AppError(404, 'Quote not found');
  }

  const { items, ...fields } = data;

  const quote = await prisma.$transaction(async (tx) => {
    // Handle items
    let totalAmount = Number(existing.totalAmount);
    if (items) {
      // Delete removed items
      const keepIds = items.filter(i => i.id).map(i => i.id!);
      await tx.quoteItem.deleteMany({
        where: { quoteId: id, id: { notIn: keepIds } },
      });

      totalAmount = 0;
      for (let idx = 0; idx < items.length; idx++) {
        const item = items[idx];
        const groups = item.groups || item.groupsCount || 1;
        const duration = item.meetingDuration || item.durationMinutes || 90;
        const subtotal = groups * item.meetingsPerGroup * item.pricePerMeeting;
        totalAmount += subtotal;

        const itemData = {
          courseName: item.courseName || '',
          courseId: item.courseId || undefined,
          description: item.description || undefined,
          groups,
          meetingsPerGroup: item.meetingsPerGroup,
          pricePerMeeting: item.pricePerMeeting,
          meetingDuration: duration,
          subtotal,
          sortOrder: item.sortOrder ?? idx,
        };

        if (item.id) {
          await tx.quoteItem.update({ where: { id: item.id }, data: itemData });
        } else {
          await tx.quoteItem.create({ data: { ...itemData, quoteId: id } });
        }
      }
    }

    const updateData: any = {};
    if (fields.branchId !== undefined) updateData.branchId = fields.branchId || undefined;
    if (fields.institutionName !== undefined) updateData.institutionName = fields.institutionName;
    if (fields.contactName !== undefined) updateData.contactName = fields.contactName;
    if (fields.contactPhone !== undefined) updateData.contactPhone = fields.contactPhone;
    if (fields.contactEmail !== undefined) updateData.contactEmail = fields.contactEmail;
    if (fields.contactRole !== undefined) updateData.contactRole = fields.contactRole;
    if (fields.clientType !== undefined) updateData.clientType = fields.clientType as any || null;
    if (fields.customerId !== undefined) updateData.customerId = fields.customerId || null;
    if (fields.payingBodyName !== undefined) updateData.payingBodyName = fields.payingBodyName || null;
    if (fields.payingBodyPhone !== undefined) updateData.payingBodyPhone = fields.payingBodyPhone || null;
    if (fields.payingBodyEmail !== undefined) updateData.payingBodyEmail = fields.payingBodyEmail || null;
    if (fields.payingBodyNotes !== undefined) updateData.payingBodyNotes = fields.payingBodyNotes || null;
    if (fields.includesVat !== undefined) updateData.includesVat = fields.includesVat;
    if (fields.cancellationTerms !== undefined) updateData.cancellationTerms = fields.cancellationTerms || null;
    if (fields.paymentTerms !== undefined) updateData.paymentTerms = fields.paymentTerms || null;
    if (fields.validUntil !== undefined) updateData.validUntil = new Date(fields.validUntil);
    if (fields.notes !== undefined) updateData.notes = fields.notes;
    if (fields.content !== undefined) updateData.content = fields.content;
    if (fields.status !== undefined) updateData.status = fields.status;
    if (data.discount !== undefined) updateData.discount = data.discount;

    // Recalculate finalAmount if items or discount changed
    if (items || data.discount !== undefined) {
      const currentDiscount = data.discount ?? Number(existing.discount);
      updateData.totalAmount = totalAmount;
      updateData.finalAmount = totalAmount - currentDiscount;
      updateData.discount = currentDiscount;
    }

    return tx.quote.update({
      where: { id },
      data: updateData,
      include: {
        items: { orderBy: { sortOrder: 'asc' } },
        branch: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true, email: true } },
      },
    });
  });

  return quote;
}

export async function deleteQuote(id: string) {
  const quote = await prisma.quote.findUnique({ where: { id } });
  if (!quote) {
    throw new AppError(404, 'Quote not found');
  }

  if (quote.status !== 'draft') {
    throw new AppError(400, 'Only draft quotes can be deleted');
  }

  await prisma.quote.delete({ where: { id } });
}

export async function generateQuoteContent(quoteId: string) {
  const quote = await getQuoteById(quoteId);

  try {
    const content = await generateQuoteAIContent({
      institutionName: quote.institutionName,
      contactName: quote.contactName,
      contactRole: quote.contactRole,
      finalAmount: Number(quote.finalAmount),
      items: quote.items.map((item) => ({
        courseName: item.courseName,
        type: (item.groups === 1 && item.meetingsPerGroup === 1 && item.description) ? 'project' as const : 'education' as const,
        description: item.description || undefined,
        groups: item.groups,
        meetingsPerGroup: item.meetingsPerGroup,
        meetingDuration: item.meetingDuration,
        pricePerMeeting: Number(item.pricePerMeeting),
        subtotal: Number(item.subtotal),
      })),
    });

    const updatedQuote = await prisma.quote.update({
      where: { id: quoteId },
      data: { content: { markdown: content } },
      include: {
        items: { orderBy: { sortOrder: 'asc' } },
        branch: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true, email: true } },
      },
    });

    return { quote: updatedQuote, content };
  } catch (error: any) {
    console.error('[QuoteContent] AI generation failed:', error.message);
    return {
      quote,
      content: null,
      error: 'שגיאה ביצירת התוכן. ניתן לכתוב את התוכן באופן ידני.',
    };
  }
}

export async function generateContentPreview(data: {
  institutionName: string;
  contactName: string;
  contactRole?: string;
  includesVat?: boolean;
  items: Array<{
    courseName: string;
    type?: 'education' | 'project';
    description?: string;
    groupsCount: number;
    meetingsPerGroup: number;
    durationMinutes: number;
    pricePerMeeting: number;
    subtotal: number;
  }>;
}) {
  const finalAmount = data.items.reduce((sum, item) => sum + item.subtotal, 0);

  const content = await generateQuoteAIContent({
    institutionName: data.institutionName,
    contactName: data.contactName,
    contactRole: data.contactRole,
    includesVat: data.includesVat,
    finalAmount,
    items: data.items.map((item) => ({
      courseName: item.courseName,
      type: item.type || ((item.groupsCount === 1 && item.meetingsPerGroup === 1) ? 'project' : 'education'),
      description: item.description,
      groups: item.groupsCount,
      meetingsPerGroup: item.meetingsPerGroup,
      meetingDuration: item.durationMinutes,
      pricePerMeeting: item.pricePerMeeting,
      subtotal: item.subtotal,
    })),
  });

  return { content };
}

export async function convertToOrder(quoteId: string) {
  const quote = await prisma.quote.findUnique({
    where: { id: quoteId },
    include: { items: true },
  });

  if (!quote) {
    throw new AppError(404, 'Quote not found');
  }

  if (quote.status === 'converted') {
    throw new AppError(400, 'Quote has already been converted to an order');
  }

  if (quote.status !== 'accepted') {
    throw new AppError(400, 'Only accepted quotes can be converted to orders');
  }

  if (!quote.branchId) {
    throw new AppError(400, 'Quote must be linked to a branch before converting to order');
  }

  const result = await prisma.$transaction(async (tx) => {
    const totalMeetings = quote.items.reduce((sum, item) => sum + item.groups * item.meetingsPerGroup, 0);
    const avgPricePerMeeting = totalMeetings > 0
      ? Number(quote.finalAmount) / totalMeetings
      : 0;

    const order = await tx.institutionalOrder.create({
      data: {
        branchId: quote.branchId!,
        orderDate: new Date(),
        startDate: new Date(),
        endDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        pricePerMeeting: avgPricePerMeeting,
        estimatedMeetings: totalMeetings,
        estimatedTotal: Number(quote.finalAmount),
        totalAmount: Number(quote.finalAmount),
        contactName: quote.contactName,
        contactPhone: quote.contactPhone,
        contactEmail: quote.contactEmail,
        notes: `Converted from quote ${quote.quoteNumber}. ${quote.notes || ''}`.trim(),
        status: 'draft',
      },
    });

    const updatedQuote = await tx.quote.update({
      where: { id: quoteId },
      data: {
        status: 'converted',
        orderId: order.id,
      },
      include: {
        items: { orderBy: { sortOrder: 'asc' } },
        branch: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true, email: true } },
      },
    });

    return { quote: updatedQuote, order };
  });

  return result;
}
