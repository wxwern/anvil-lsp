import { z } from "zod";


export const AnvilPosSchema = z.object({ line: z.number(), col: z.number() });
export type AnvilPos = z.infer<typeof AnvilPosSchema>;

export const AnvilSpanSchema = z.object({
  start: AnvilPosSchema,
  end: AnvilPosSchema,
});
export type AnvilSpan = z.infer<typeof AnvilSpanSchema>;

export const AnvilDefSpanSchema = AnvilSpanSchema.extend({
  file_name: z.string().nullable().optional(),
});
export type AnvilDefSpan = z.infer<typeof AnvilDefSpanSchema>;

export const AnvilSpannableSchema = z.object({
  kind: z.string().optional(),
  span: AnvilSpanSchema,
  def_span: z.array(AnvilDefSpanSchema).optional(),
  action_event: z
    .object({
      tid: z.number(),
      eid: z.number(),
      to_eid: z.number().nullable().optional(),
    })
    .optional(),
});
export type AnvilSpannable = z.infer<typeof AnvilSpannableSchema>;


export const AnvilUnknownNodeSchema = z.record(z.string(), z.unknown());
export type AnvilUnknownNode = z.infer<typeof AnvilUnknownNodeSchema>;


export const AnvilRegisterSchema = AnvilSpannableSchema.extend({
  kind: z.literal("reg_def"),
  name: z.string(),
}).and(AnvilUnknownNodeSchema);
export type AnvilRegister = z.infer<typeof AnvilRegisterSchema>;

export const AnvilEndpointSchema = AnvilSpannableSchema.extend({
  kind: z.literal("endpoint_def"),
  channel_class: z.string(),
}).and(AnvilUnknownNodeSchema);
export type AnvilEndpoint = z.infer<typeof AnvilEndpointSchema>;

export const AnvilChannelSchema = AnvilSpannableSchema.extend({
  kind: z.literal("channel_def"),
  channel_class: z.string(),
  endpoint_left: z.string(),
  endpoint_right: z.string(),
}).and(AnvilUnknownNodeSchema);
export type AnvilChannel = z.infer<typeof AnvilChannelSchema>;

export const AnvilExprSchema = AnvilSpannableSchema.extend({
  kind: z.literal("expr"),
  type: z.string(),
}).and(AnvilUnknownNodeSchema);
export type AnvilExpr = z.infer<typeof AnvilExprSchema>;

export const AnvilThreadSchema = z.object({
  expr: AnvilExprSchema,
  rst: AnvilUnknownNodeSchema.optional().nullable(),
});


export const AnvilChannelClassSchema = z.object({
  kind: z.literal("channel_class_def"),
})
  .and(AnvilSpannableSchema)
  .and(AnvilUnknownNodeSchema);
export type AnvilChannelClass = z.infer<typeof AnvilChannelClassSchema>;

export const AnvilTypeSchema = z.object({
  kind: z.literal("type_def"),
})
  .and(AnvilSpannableSchema)
  .and(AnvilUnknownNodeSchema);
export type AnvilType = z.infer<typeof AnvilTypeSchema>;

export const AnvilMacroSchema = z.object({
  kind: z.literal("macro_def"),
})
  .and(AnvilSpannableSchema)
  .and(AnvilUnknownNodeSchema);
export type AnvilMacro = z.infer<typeof AnvilMacroSchema>;

export const AnvilFuncSchema = z.object({
  kind: z.literal("func_def"),
})
  .and(AnvilSpannableSchema)
  .and(AnvilUnknownNodeSchema);
export type AnvilFunc = z.infer<typeof AnvilFuncSchema>;

export const AnvilProcSchema = z.object({
  kind: z.literal("proc_def"),
  name: z.string(),
  args: z.array(AnvilEndpointSchema),
  body: (
    z.object({
      type: z.literal("native"),
      channels: z.array(AnvilChannelSchema),
      regs: z.array(AnvilRegisterSchema),
      threads: z.array(AnvilThreadSchema),
    })
      .or(z.object({
        type: z.literal("extern")
      }))
  ).and(AnvilUnknownNodeSchema),
})
  .and(AnvilSpannableSchema)
  .and(AnvilUnknownNodeSchema);
export type AnvilProc = z.infer<typeof AnvilProcSchema>;


export const AnvilEventGraphSchema = z.object({
  proc_name: z.string(),
  threads: z.array(
    z.object({
      tid: z.number(),
      events: z.array(
        z.object({
          eid: z.number(),
          delays: z.array(z.number()).default([]),
          outs: z.array(
            z.object({
              tid: z.number(),
              eid: z.number(),
            })
          ).optional(),
        })
      ),
      span: AnvilSpanSchema,
    })
  ),
});
export type AnvilEventGraph = z.infer<typeof AnvilEventGraphSchema>;

export const AnvilCompUnitSchema = z.object({
  file_name: z.string(),
  channel_classes: z.array(AnvilChannelClassSchema),
  type_defs: z.array(AnvilTypeSchema),
  macro_defs: z.array(AnvilMacroSchema),
  func_defs: z.array(AnvilFuncSchema),
  procs: z.array(AnvilProcSchema),
  imports: z.array(
    z.object({
      file_name: z.string(),
      is_extern: z.boolean(),
      span: AnvilSpanSchema,
    })
  ),
  event_graphs: z.array(AnvilEventGraphSchema).optional().nullable(),
});
export type AnvilCompUnit = z.infer<typeof AnvilCompUnitSchema>;
