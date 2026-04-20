import { z } from 'zod';
import { isAstSchemaVersionCompatible } from './utils';

//
// SCHEMA VERSIONING AND VALIDATION
//

export const REQUIRED_AST_SCHEMA_VERSION = 'v0.1.0-wip.1';

const AnvilAstSchemaVersionStringSchema = z
  .string()
  .refine(
    (versionStr) =>
      isAstSchemaVersionCompatible(versionStr, REQUIRED_AST_SCHEMA_VERSION),
    {
      message: `AST schema must match ${REQUIRED_AST_SCHEMA_VERSION} or newer non-major version!`,
    },
  );

//
// PRIMITIVES
//

/**
 * A term in a cycle time sum expression.
 *
 * Possible terms (recursive):
 *
 * - An integer literal (e.g. { const: 5 })
 * - A string literal representing an unknown (e.g. { sym: "n1" })
 * - OR of a list of cycle time sums (e.g. { or: AnvilCycleTime[] })
 * - MAX of a list of cycle time sums (e.g. { sym: "max3", max: AnvilCycleTime[] })
 *
 * A cycle time sum is represented as an array of terms that are added together.
 * For example, "1 + (5 or n1) + max{n2, n3}" would be:
 * [
 *   { const: 1 },
 *   { or: [[{ const: 5 }], [{ sym: "n1" }]] },
 *   { sym: "max1", max: [[{ sym: "n2" }], [{ sym: "n3" }]] }
 * ]
 */

// Dev note: Previously AnvilCycleTime = (int | str)[], which was a simpler array of constants or symbols.
// Now it's an array of more complex term objects that can represent OR and MAX operations recursively.

// Forward-declare for recursion
export type AnvilCycleTimeTerm =
  | { const: number }
  | { sym: string }
  | { sym?: string; or: AnvilCycleTime[] }
  | { sym?: string; max: AnvilCycleTime[] };

export type AnvilCycleTime = AnvilCycleTimeTerm[];

export const AnvilCycleTimeTermSchema: z.ZodType<AnvilCycleTimeTerm> = z.lazy(
  () =>
    z.union([
      z.looseObject({ const: z.number().int() }),
      z.looseObject({ sym: z.string() }),
      z.looseObject({
        sym: z.string().optional(),
        or: z.array(z.lazy(() => AnvilCycleTimeSchema)),
      }),
      z.looseObject({
        sym: z.string().optional(),
        max: z.array(z.lazy(() => AnvilCycleTimeSchema)),
      }),
    ]),
);

export const AnvilCycleTimeSchema: z.ZodType<AnvilCycleTime> = z.array(
  AnvilCycleTimeTermSchema,
);

export const AnvilPositionSchema = z.looseObject({
  line: z.number().int(),
  col: z.number().int(),
});
export type AnvilPosition = z.infer<typeof AnvilPositionSchema>;

/**
 * A span with a start and end position. Matches code_span_to_yojson: { start, end }
 */
export const AnvilSpanSchema = z.looseObject({
  start: AnvilPositionSchema,
  end: AnvilPositionSchema,
});
export type AnvilSpan = z.infer<typeof AnvilSpanSchema>;

/**
 * A span that also carries an optional file_name (used in def_span entries).
 * Matches def_span_to_yojson: { file_name, start, end }
 */
export const AnvilDefSpanSchema = z.looseObject({
  file_name: z.string().nullable().optional(),
  start: AnvilPositionSchema,
  end: AnvilPositionSchema,
});
export type AnvilDefSpan = z.infer<typeof AnvilDefSpanSchema>;

/**
 * After AnvilAstNode::deepFlattenNode during init, every ast_node wrapper is merged
 * into its data object. The resulting object always has a `span` field and
 * optionally `event` / `def_span`.
 *
 * Matches ast_node_to_yojson output where:
 *   - "span" is the code_span
 *   - "event" is the action_event (tid, eid, optional sustain_lifetime)
 *   - "def_span" is the array of definition spans
 */
export const AnvilSpannableSchema = z.looseObject({
  kind: z.string().optional(),
  span: AnvilSpanSchema,
  def_span: z.array(AnvilDefSpanSchema).optional(),
  event: z
    .looseObject({
      tid: z.number().int(),
      eid: z.number().int(),
      sustain_lifetime: AnvilCycleTimeSchema.nullable().optional(),
      delay_to_exec: AnvilCycleTimeSchema.optional(),
    })
    .optional()
    .nullable(),
});
export type AnvilSpannable = z.infer<typeof AnvilSpannableSchema>;

//
// LITERAL SCHEMA
// literal_to_yojson: { kind: "literal", type: "binary"|"decimal"|"hex"|"with_length"|"no_length", ... }
//

export const AnvilLiteralSchema = z.discriminatedUnion('type', [
  z.looseObject({
    kind: z.literal('literal'),
    type: z.literal('binary'),
    length: z.number().int(),
    digits: z.array(z.number().int()),
  }),
  z.looseObject({
    kind: z.literal('literal'),
    type: z.literal('decimal'),
    length: z.number().int(),
    digits: z.array(z.number().int()),
  }),
  z.looseObject({
    kind: z.literal('literal'),
    type: z.literal('hex'),
    length: z.number().int(),
    digits: z.array(z.number().int()),
  }),
  z.looseObject({
    kind: z.literal('literal'),
    type: z.literal('with_length'),
    length: z.number().int(),
    value: z.number().int(),
  }),
  z.looseObject({
    kind: z.literal('literal'),
    type: z.literal('no_length'),
    value: z.number().int(),
  }),
]);
export type AnvilLiteral = z.infer<typeof AnvilLiteralSchema>;

//
// PARAMS
// param_type_to_yojson: "int" | "type"
// param_to_yojson: { kind: "param", name, type }
//

export const AnvilParamTypeSchema = z.enum(['int', 'type']);
export type AnvilParamType = z.infer<typeof AnvilParamTypeSchema>;

export const AnvilParamSchema = z.looseObject({
  kind: z.literal('param'),
  name: z.string(),
  type: AnvilParamTypeSchema,
});
export type AnvilParam = z.infer<typeof AnvilParamSchema>;

//
// DATA TYPES (recursive)
// data_type_to_yojson: { kind: "data_type", type: ..., ... }
// param_value_to_yojson: { kind: "param_value", type: "int"|"type", ... }
//

// Forward-declare types for recursion
export type AnvilParamValue =
  | { kind: 'param_value'; type: 'int'; value: number }
  | { kind: 'param_value'; type: 'type'; data_type: AnvilDataType };

export type AnvilDataType = {
  kind: 'data_type';
} & (
  | { type: 'logic' }
  | {
      type: 'array';
      element: AnvilDataType;
      size: { param: string } | { value: number };
    }
  | { type: 'tuple'; elements: AnvilDataType[] }
  | { type: 'record'; elements: unknown[] }
  | {
      type: 'variant';
      data_type: AnvilDataType | null;
      elements: unknown[];
    }
  | { type: 'opaque'; name: string }
  | { type: 'named'; name: string; params: AnvilParamValue[] }
);

export const AnvilParamValueSchema: z.ZodType<AnvilParamValue> = z.lazy(() =>
  z.discriminatedUnion('type', [
    z.looseObject({
      kind: z.literal('param_value'),
      type: z.literal('int'),
      value: z.number().int(),
    }),
    z.looseObject({
      kind: z.literal('param_value'),
      type: z.literal('type'),
      data_type: AnvilDataTypeSchema,
    }),
  ]),
);

export const AnvilDataTypeSchema: z.ZodType<AnvilDataType> = z.lazy(() =>
  z.looseObject({ kind: z.literal('data_type') }).and(
    z.discriminatedUnion('type', [
      z.looseObject({ type: z.literal('logic') }),
      z.looseObject({
        type: z.literal('array'),
        element: AnvilDataTypeSchema,
        size: z.union([
          z.looseObject({ param: z.string() }),
          z.looseObject({ value: z.number().int() }),
        ]),
      }),
      z.looseObject({
        type: z.literal('tuple'),
        elements: z.array(AnvilDataTypeSchema),
      }),
      z.looseObject({
        type: z.literal('record'),
        elements: z.array(
          AnvilSpannableSchema.extend({
            kind: z.literal('type_element_def'),
            name: z.string(),
            data_type: AnvilDataTypeSchema,
          }),
        ),
      }),
      z.looseObject({
        type: z.literal('variant'),
        data_type: AnvilDataTypeSchema.nullable(),
        elements: z.array(
          AnvilSpannableSchema.extend({
            kind: z.literal('type_element_def'),
            name: z.string(),
            data_type: AnvilDataTypeSchema.nullable().optional(),
            literal: AnvilLiteralSchema.nullable().optional(),
          }),
        ),
      }),
      z.looseObject({
        type: z.literal('opaque'),
        name: z.string(),
      }),
      z.looseObject({
        type: z.literal('named'),
        name: z.string(),
        params: z.array(AnvilParamValueSchema),
      }),
    ]),
  ),
);

//
// MESSAGE SPECIFIER
// message_specifier_to_yojson: { kind: "message_specifier", endpoint, msg }
//

export const AnvilMessageSpecifierSchema = z.looseObject({
  kind: z.literal('message_specifier'),
  endpoint: z.string(),
  msg: z.string(),
});
export type AnvilMessageSpecifier = z.infer<typeof AnvilMessageSpecifierSchema>;

//
// DELAY PATTERNS
// delay_pat_to_yojson: { kind: "delay_pat", type: "cycles"|"message"|"eternal", ... }
// delay_pat_chan_local_to_yojson: { kind: "delay_pat_chan_local", ... }
//

export const AnvilDelayPatSchema = z
  .looseObject({ kind: z.literal('delay_pat') })
  .and(
    z.discriminatedUnion('type', [
      z.looseObject({
        type: z.literal('cycles'),
        value: z.number().int(),
      }),
      z.looseObject({
        type: z.literal('message'),
        value: AnvilMessageSpecifierSchema,
        offset: z.number().int(),
      }),
      z.looseObject({ type: z.literal('eternal') }),
    ]),
  );
export type AnvilDelayPat = z.infer<typeof AnvilDelayPatSchema>;

export const AnvilDelayPatChanLocalSchema = z
  .looseObject({ kind: z.literal('delay_pat_chan_local') })
  .and(
    z.discriminatedUnion('type', [
      z.looseObject({
        type: z.literal('cycles'),
        value: z.number().int(),
      }),
      z.looseObject({
        type: z.literal('message'),
        value: z.string(),
        offset: z.number().int(),
      }),
      z.looseObject({ type: z.literal('eternal') }),
    ]),
  );
export type AnvilDelayPatChanLocal = z.infer<
  typeof AnvilDelayPatChanLocalSchema
>;

//
// SIGNAL LIFETIMES
// sig_lifetime_to_yojson: { kind: "sig_lifetime", ending }
// sig_lifetime_chan_local_to_yojson: { kind: "sig_lifetime_chan_local", ending }
//

export const AnvilSigLifetimeSchema = z.looseObject({
  kind: z.literal('sig_lifetime'),
  ending: AnvilDelayPatSchema,
});
export type AnvilSigLifetime = z.infer<typeof AnvilSigLifetimeSchema>;

export const AnvilSigLifetimeChanLocalSchema = z.looseObject({
  kind: z.literal('sig_lifetime_chan_local'),
  ending: AnvilDelayPatChanLocalSchema,
});
export type AnvilSigLifetimeChanLocal = z.infer<
  typeof AnvilSigLifetimeChanLocalSchema
>;

//
// SIGNAL TYPES
// sig_type_to_yojson: { kind: "sig_type", data_type, lifetime }
// sig_type_chan_local_to_yojson: { kind: "sig_type_chan_local", data_type, lifetime }
//

export const AnvilSigTypeSchema = z.looseObject({
  kind: z.literal('sig_type'),
  data_type: AnvilDataTypeSchema,
  lifetime: AnvilSigLifetimeSchema,
});
export type AnvilSigType = z.infer<typeof AnvilSigTypeSchema>;

export const AnvilSigTypeChanLocalSchema = z.looseObject({
  kind: z.literal('sig_type_chan_local'),
  data_type: AnvilDataTypeSchema,
  lifetime: AnvilSigLifetimeChanLocalSchema,
});
export type AnvilSigTypeChanLocal = z.infer<typeof AnvilSigTypeChanLocalSchema>;

//
// MESSAGE SYNC MODE
// message_sync_mode_to_yojson: { kind: "message_sync_mode", type, ... }
//

export const AnvilMessageSyncModeSchema = z
  .looseObject({ kind: z.literal('message_sync_mode') })
  .and(
    z.discriminatedUnion('type', [
      z.looseObject({ type: z.literal('dynamic') }),
      z.looseObject({
        type: z.literal('static'),
        init: z.number().int(),
        interval: z.number().int(),
      }),
      z.looseObject({
        type: z.literal('dependent'),
        msg: z.string(),
        delay: z.number().int(),
      }),
    ]),
  );
export type AnvilMessageSyncMode = z.infer<typeof AnvilMessageSyncModeSchema>;

//
// MESSAGE_DEF
// { kind: "message_def", name, dir, send_sync, recv_sync, sig_types, span }
//

export const AnvilMessageDefSchema = z.looseObject({
  kind: z.literal('message_def'),
  name: z.string(),
  dir: z.enum(['in', 'out']),
  send_sync: AnvilMessageSyncModeSchema,
  recv_sync: AnvilMessageSyncModeSchema,
  sig_types: z.array(AnvilSigTypeChanLocalSchema),
  span: AnvilSpanSchema,
});
export type AnvilMessageDef = z.infer<typeof AnvilMessageDefSchema>;

//
// CHANNEL_CLASS_DEF
// { kind: "channel_class_def", name, messages, params, span, file_name }
//

export const AnvilChannelClassSchema = z.looseObject({
  kind: z.literal('channel_class_def'),
  name: z.string(),
  messages: z.array(AnvilMessageDefSchema),
  params: z.array(AnvilParamSchema),
  span: AnvilSpanSchema,
  file_name: z.string().nullable().optional(),
});
export type AnvilChannelClass = z.infer<typeof AnvilChannelClassSchema>;

//
// TYPE_DEF
// { kind: "type_def", name, data_type, params, span, file_name }
//

export const AnvilTypeSchema = z.looseObject({
  kind: z.literal('type_def'),
  name: z.string(),
  data_type: AnvilDataTypeSchema,
  params: z.array(AnvilParamSchema),
  span: AnvilSpanSchema,
  file_name: z.string().nullable().optional(),
});
export type AnvilType = z.infer<typeof AnvilTypeSchema>;

//
// MACRO_DEF
// { kind: "macro_def", id, value, span, file_name }
//

export const AnvilMacroSchema = z.looseObject({
  kind: z.literal('macro_def'),
  id: z.string(),
  value: z.number().int(),
  span: AnvilSpanSchema,
  file_name: z.string().nullable().optional(),
});
export type AnvilMacro = z.infer<typeof AnvilMacroSchema>;

//
// TYPED_ARG
// { kind: "typed_arg", name, data_type, span }
//

export const AnvilTypedArgSchema = z.looseObject({
  kind: z.literal('typed_arg'),
  name: z.string(),
  data_type: AnvilDataTypeSchema.nullable().optional(),
  span: AnvilSpanSchema,
});
export type AnvilTypedArg = z.infer<typeof AnvilTypedArgSchema>;

//
// FUNC_DEF
// { kind: "func_def", name, args, body (flattened expr_node), span, file_name }
//

export const AnvilFuncSchema = z.looseObject({
  kind: z.literal('func_def'),
  name: z.string(),
  args: z.array(AnvilTypedArgSchema),
  body: AnvilSpannableSchema, // flattened ast_node wrapping an expr
  span: AnvilSpanSchema,
  file_name: z.string().nullable().optional(),
});
export type AnvilFunc = z.infer<typeof AnvilFuncSchema>;

//
// REG_DEF
// (emitted inside an ast_node, flattened by deepFlattenNode)
// { kind: "reg_def", name, data_type, init, span, event?, def_span? }
//

export const AnvilRegisterSchema = AnvilSpannableSchema.extend({
  kind: z.literal('reg_def'),
  name: z.string(),
  data_type: AnvilDataTypeSchema,
  init: z.string().nullable().optional(),
});
export type AnvilRegister = z.infer<typeof AnvilRegisterSchema>;

//
// ENDPOINT_DEF
// (emitted inside an ast_node, flattened by deepFlattenNode)
// { kind: "endpoint_def", name, channel_class, channel_params, dir, foreign, opp, span, event?, def_span? }
//

export const AnvilEndpointSchema = AnvilSpannableSchema.extend({
  kind: z.literal('endpoint_def'),
  name: z.string(),
  channel_class: z.string(),
  channel_params: z.array(AnvilParamValueSchema),
  dir: z.enum(['left', 'right']),
  foreign: z.boolean(),
  opp: z.string().nullable().optional(),
});
export type AnvilEndpoint = z.infer<typeof AnvilEndpointSchema>;

//
// CHANNEL_DEF
// (emitted inside an ast_node, flattened by deepFlattenNode)
// { kind: "channel_def", channel_class, channel_params, endpoint_left, endpoint_right, visibility, span, event?, def_span? }
//

export const AnvilChannelSchema = AnvilSpannableSchema.extend({
  kind: z.literal('channel_def'),
  channel_class: z.string(),
  channel_params: z.array(AnvilParamValueSchema),
  endpoint_left: z.string(),
  endpoint_right: z.string(),
  visibility: z.enum(['both_foreign', 'left_foreign', 'right_foreign']),
});
export type AnvilChannel = z.infer<typeof AnvilChannelSchema>;

//
// EXPR
// (emitted inside an ast_node, flattened by deepFlattenNode)
// { kind: "expr", type: <expr-type>, span, event?, def_span?, ...expr-specific fields }
//

export const AnvilExprSchema = AnvilSpannableSchema.extend({
  kind: z.literal('expr'),
  type: z.string(),
}).loose();
export type AnvilExpr = z.infer<typeof AnvilExprSchema>;

//
// THREAD
// { kind: "thread", expr: <flattened expr_node>, span, rst: message_specifier | null }
//

export const AnvilThreadSchema = z.looseObject({
  kind: z.literal('thread'),
  expr: AnvilExprSchema,
  span: AnvilSpanSchema,
  rst: AnvilMessageSpecifierSchema.nullable(),
});
export type AnvilThread = z.infer<typeof AnvilThreadSchema>;

//
// SPAWN_DEF / ARGS_SPAWN
// spawn_def_to_yojson: { kind: "spawn_def", proc, params, compile_params }
// args_spawn_to_yojson: { kind: "args_spawn", type: "single"|"indexed", ... }
//

export const AnvilArgsSpawnSchema = z
  .looseObject({ kind: z.literal('args_spawn') })
  .and(
    z.discriminatedUnion('type', [
      z.looseObject({ type: z.literal('single'), endpoint: z.string() }),
      z.looseObject({
        type: z.literal('indexed'),
        endpoint: z.string(),
        dimensions: z.looseObject({
          kind: z.literal('array_index_concrete'),
        }),
      }),
    ]),
  );
export type AnvilArgsSpawn = z.infer<typeof AnvilArgsSpawnSchema>;

export const AnvilSpawnDefSchema = z.looseObject({
  kind: z.literal('spawn_def'),
  proc: z.string(),
  params: z.array(AnvilArgsSpawnSchema),
  compile_params: z.array(AnvilParamValueSchema),
});
export type AnvilSpawnDef = z.infer<typeof AnvilSpawnDefSchema>;

//
// SHARED_VAR_DEF
// (emitted inside an ast_node, flattened)
// { kind: "shared_var_def", ident, assigning_thread, shared_lifetime, span, event?, def_span? }
//

export const AnvilSharedVarDefSchema = AnvilSpannableSchema.extend({
  kind: z.literal('shared_var_def'),
  ident: z.string(),
  assigning_thread: z.number().int(),
  shared_lifetime: AnvilSigLifetimeSchema,
});
export type AnvilSharedVarDef = z.infer<typeof AnvilSharedVarDefSchema>;

//
// PROC_DEF_BODY
// { kind: "proc_def_body", type: "native"|"extern", ... }
//

export const AnvilProcDefBodyNativeSchema = z.looseObject({
  kind: z.literal('proc_def_body'),
  type: z.literal('native'),
  channels: z.array(AnvilChannelSchema),
  spawns: z.array(AnvilSpawnDefSchema),
  regs: z.array(AnvilRegisterSchema),
  shared_vars: z.array(AnvilSharedVarDefSchema),
  threads: z.array(AnvilThreadSchema),
});

export type AnvilProcDefBodyNative = z.infer<
  typeof AnvilProcDefBodyNativeSchema
>;

export const AnvilProcDefBodyExternSchema = z.looseObject({
  kind: z.literal('proc_def_body'),
  type: z.literal('extern'),
  module_name: z.string(),
  named_ports: z.array(z.looseObject({ name: z.string(), type: z.string() })),
  msg_ports: z.array(
    z.looseObject({
      msg_spec: AnvilMessageSpecifierSchema,
      data_port: z.string().nullable(),
      valid_port: z.string().nullable(),
      ack_port: z.string().nullable(),
    }),
  ),
});

export type AnvilProcDefBodyExtern = z.infer<
  typeof AnvilProcDefBodyExternSchema
>;

export const AnvilProcBodySchema = z.discriminatedUnion('type', [
  AnvilProcDefBodyNativeSchema,
  AnvilProcDefBodyExternSchema,
]);

export type AnvilProcBody = z.infer<typeof AnvilProcBodySchema>;

//
// PROC_DEF
// { kind: "proc_def", name, args, body, params, span, file_name }
//

export const AnvilProcSchema = z.looseObject({
  kind: z.literal('proc_def'),
  name: z.string(),
  args: z.array(AnvilEndpointSchema),
  body: AnvilProcBodySchema,
  params: z.array(AnvilParamSchema),
  span: AnvilSpanSchema,
  file_name: z.string().nullable().optional(),
});
export type AnvilProc = z.infer<typeof AnvilProcSchema>;

//
// IMPORT_DIRECTIVE
// { kind: "import_directive", file_name, is_extern, span }
//

export const AnvilImportDirectiveSchema = z.looseObject({
  kind: z.literal('import_directive'),
  file_name: z.string(),
  is_extern: z.boolean(),
  span: AnvilSpanSchema,
});
export type AnvilImportDirective = z.infer<typeof AnvilImportDirectiveSchema>;

//
// EVENT_GRAPH_COLLECTION
// { proc_name, threads: [ { tid, events: [ { eid, delays, outs? } ], span } ] }
//

export const AnvilEventGraphSchema = z.looseObject({
  proc_name: z.string(),
  threads: z.array(
    z.looseObject({
      tid: z.number().int(),
      events: z.array(
        z.looseObject({
          eid: z.number().int(),
          delay: AnvilCycleTimeSchema.default([]),
          outs: z
            .array(
              z.looseObject({
                tid: z.number().int(),
                eid: z.number().int(),
              }),
            )
            .optional(),
        }),
      ),
      span: AnvilSpanSchema,
    }),
  ),
});
export type AnvilEventGraph = z.infer<typeof AnvilEventGraphSchema>;

//
// COMPILATION_UNIT_WITH_SUPPLEMENTARY_DATA
// { kind: "compilation_unit", file_name, channel_classes, type_defs, macro_defs,
//   func_defs, procs, imports, _extern_procs, event_graphs? }
//

export const AnvilCompUnitSchema = z.looseObject({
  schema: AnvilAstSchemaVersionStringSchema,
  kind: z.literal('compilation_unit'),
  file_name: z.string().nullable().optional(),
  channel_classes: z.array(AnvilChannelClassSchema),
  type_defs: z.array(AnvilTypeSchema),
  macro_defs: z.array(AnvilMacroSchema),
  func_defs: z.array(AnvilFuncSchema),
  procs: z.array(AnvilProcSchema),
  imports: z.array(AnvilImportDirectiveSchema),
  _extern_procs: z.array(AnvilProcSchema),
  event_graphs: z.array(AnvilEventGraphSchema).optional().nullable(),
});
export type AnvilCompUnit = z.infer<typeof AnvilCompUnitSchema>;
