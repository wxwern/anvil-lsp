
/*
(** AST output module for anvil parser results *)

open Lang

let message_sync_mode_to_json (msm : Lang.message_sync_mode) : Yojson.Basic.t =
  match msm with
  | Lang.Dynamic -> `String "dynamic"
  | Lang.Static (init, interval) ->
    `Assoc [("type", `String "static");
            ("init_offset", `Int init);
            ("interval", `Int interval)]
  | Lang.Dependent (msg_name, delay) ->
    `Assoc [("type", `String "dependent");
            ("message", `String msg_name);
            ("delay", `Int delay)]

let message_direction_to_json (md : Lang.message_direction) : Yojson.Basic.t =
  match md with
  | Lang.Inp -> `String "in"
  | Lang.Out -> `String "out"

let rec data_type_to_json (dt : Lang.data_type) : Yojson.Basic.t =
  match dt with
  | `Logic ->
    `Assoc [("type", `String "logic")]
  | `Array (elem_ty, size) ->
    let size_json = match size with
      | ParamEnv.Concrete n -> `Int n
      | ParamEnv.Param p -> `String p
    in
    `Assoc [("type", `String "array");
            ("element_type", data_type_to_json elem_ty);
            ("size", size_json)]
  | `Variant vlist ->
    let variants_json = List.map (fun (name, ty_opt) ->
      let ty_json = match ty_opt with
        | Some ty -> data_type_to_json ty
        | None -> `Null
      in
      `Assoc [("name", `String name); ("type", ty_json)]
    ) vlist in
    `Assoc [("type", `String "variant");
            ("constructors", `List variants_json)]
  | `Record fields ->
    let fields_json = List.map (fun (name, ty) ->
      `Assoc [("name", `String name); ("type", data_type_to_json ty)]
    ) fields in
    `Assoc [("type", `String "record");
            ("fields", `List fields_json)]
  | `Tuple types ->
    let types_json = List.map data_type_to_json types in
    `Assoc [("type", `String "tuple");
            ("elements", `List types_json)]
  | `Opaque name ->
    `Assoc [("type", `String "opaque");
            ("name", `String name)]
  | `Named (name, params) ->
    let params_json = List.map (function
      | Lang.IntParamValue n -> `Assoc [("type", `String "int"); ("value", `Int n)]
      | Lang.TypeParamValue ty -> `Assoc [("type", `String "type"); ("value", data_type_to_json ty)]
    ) params in
    `Assoc [("type", `String "named");
            ("name", `String name);
            ("params", `List params_json)]

let code_span_to_json (cs : Lang.code_span) : Yojson.Basic.t =
  let assoc = [
    ("start_line", `Int cs.st.Lexing.pos_lnum);
    ("start_cnum", `Int (cs.st.Lexing.pos_cnum - cs.st.Lexing.pos_bol));
    ("end_line", `Int cs.ed.Lexing.pos_lnum);
    ("end_cnum", `Int (cs.ed.Lexing.pos_cnum - cs.ed.Lexing.pos_bol));
  ] in
  `Assoc assoc

let param_to_json (p : Lang.param) : Yojson.Basic.t =
  match (p.param_name, p.param_ty) with
  | (name, Lang.IntParam) ->
    `Assoc [("name", `String name); ("type", `String "int")]
  | (name, Lang.TypeParam) ->
    `Assoc [("name", `String name); ("type", `String "type")]

let type_def_to_json (td : Lang.type_def) : Yojson.Basic.t =
  let assoc = [
    ("name", `String td.name);
    ("body", data_type_to_json td.body);
    ("params", `List (List.map (fun p -> param_to_json p) td.params));
  ] in
  `Assoc assoc

let macro_def_to_json (md : Lang.macro_def) : Yojson.Basic.t =
  let assoc = [
    ("id", `String md.id);
    ("value", `Int md.value);
  ] in
  `Assoc assoc

let message_specifier_to_json (ms : Lang.message_specifier) : Yojson.Basic.t =
  let assoc = [
    ("endpoint", `String ms.endpoint);
    ("message", `String ms.msg);
  ] in
  `Assoc assoc

let sig_lifetime_chan_local_to_json (lt : Lang.sig_lifetime_chan_local) : Yojson.Basic.t =
  match lt with
  | Lang.{e} ->
    let assoc = match e with
      | `Cycles n -> [("type", `String "cycles"); ("value", `Int n)]
      | `Message msg -> [("type", `String "message"); ("value", `String msg)]
      | `Eternal -> [("type", `String "eternal")]
    in
    `Assoc assoc

let sig_lifetime_to_json (lt : Lang.sig_lifetime) : Yojson.Basic.t =
  match lt with
  | Lang.{e} ->
    let assoc = match e with
      | `Cycles n -> [("type", `String "cycles"); ("value", `Int n)]
      | `Message msg -> [("type", `String "message"); ("value", message_specifier_to_json msg)]
      | `Eternal -> [("type", `String "eternal")]
    in
    `Assoc assoc

let sig_type_chan_local_to_json (st : Lang.sig_type_chan_local) : Yojson.Basic.t =
  match st with
  | Lang.{dtype; lifetime} ->
    let assoc = [
      ("dtype", data_type_to_json dtype);
      ("lifetime", sig_lifetime_chan_local_to_json lifetime);
    ] in
  `Assoc assoc

let message_def_to_json (msg : Lang.message_def) : Yojson.Basic.t =
  let assoc = [
    ("name", `String msg.name);
    ("direction", message_direction_to_json msg.dir);
    ("send_sync", message_sync_mode_to_json msg.send_sync);
    ("recv_sync", message_sync_mode_to_json msg.recv_sync);
    ("signal_types", `List (List.map (fun st -> sig_type_chan_local_to_json st) msg.sig_types));
    ("span", code_span_to_json msg.span);
  ] in
  `Assoc assoc

let channel_class_def_to_json (cc : Lang.channel_class_def) : Yojson.Basic.t =
  let assoc = [
    ("name", `String cc.name);
    ("messages", `List (List.map message_def_to_json cc.messages));
    ("params", `List (List.map (fun p -> param_to_json p) cc.params));
    ("span", code_span_to_json cc.span);
  ] in
  `Assoc assoc

let channel_def_to_json (cd : Lang.channel_def) : Yojson.Basic.t =
  let visibility_str = match cd.visibility with
    | Lang.BothForeign -> "both_foreign"
    | Lang.LeftForeign -> "left_foreign"
    | Lang.RightForeign -> "right_foreign"
  in
  let assoc = [
    ("channel_class", `String cd.channel_class);
    ("channel_params", `List (List.map (fun pv -> match pv with
      | Lang.IntParamValue n -> `Assoc [("type", `String "int"); ("value", `Int n)]
      | Lang.TypeParamValue ty -> `Assoc [("type", `String "type"); ("value", data_type_to_json ty)]
    ) cd.channel_params));
    ("endpoint_left", `String cd.endpoint_left);
    ("endpoint_right", `String cd.endpoint_right);
    ("visibility", `String visibility_str);
  ] in
  `Assoc assoc

let spawn_def_to_json (sd : Lang.spawn_def) : Yojson.Basic.t =
  let assoc = [
    ("proc", `String sd.proc);
    ("params", `List (List.map (fun p -> `String p) sd.params));
    ("compile_params", `List (List.map (fun pv -> match pv with
      | Lang.IntParamValue n -> `Assoc [("type", `String "int"); ("value", `Int n)]
      | Lang.TypeParamValue ty -> `Assoc [("type", `String "type"); ("value", data_type_to_json ty)]
    ) sd.compile_params));
  ] in
  `Assoc assoc

let reg_def_to_json (rd : Lang.reg_def) : Yojson.Basic.t =
  let assoc = [
    ("name", `String rd.name);
    ("dtype", data_type_to_json rd.dtype);
    ("init", match rd.init with Some e -> `String e | None -> `Null);
  ] in
  `Assoc assoc

let shared_var_def_to_json (svd : Lang.shared_var_def) : Yojson.Basic.t =
  let assoc = [
    ("ident", `String svd.ident);
    ("assigning_thread", `Int svd.assigning_thread);
    ("shared_lifetime",  sig_lifetime_to_json svd.shared_lifetime);
  ] in
  `Assoc assoc


let endpoint_def_to_json (ed : Lang.endpoint_def) : Yojson.Basic.t =
  let assoc = [
    ("name", `String ed.name);
    ("channel_class", `String ed.channel_class);
    ("channel_params", `List (List.map (fun pv -> match pv with
      | Lang.IntParamValue n -> `Assoc [("type", `String "int"); ("value", `Int n)]
      | Lang.TypeParamValue ty -> `Assoc [("type", `String "type"); ("value", data_type_to_json ty)]
    ) ed.channel_params));
    ("direction", (match ed.dir with Lang.Left -> `String "left" | Lang.Right -> `String "right"));
    ("foreign", `Bool ed.foreign);
    ("opposite_endpoint", match ed.opp with Some opp_name -> `String opp_name | None -> `Null);
  ] in
  `Assoc assoc

let rec expr_node_to_json (e : Lang.expr_node) : Yojson.Basic.t =
  let expr = match e.d with
  | Lang.Literal lit ->
    let lit_json = match lit with
      | Lang.Binary (n, bits) ->
        let bits_str = String.concat "" (List.map (function `Z0 -> "0" | `Z1 -> "1") bits) in
        `Assoc [("type", `String "binary"); ("bit_length", `Int n); ("value", `String bits_str)]
      | Lang.Decimal (n, digits) ->
        let digits_str = String.concat "" (List.map string_of_digit digits) in
        `Assoc [("type", `String "decimal"); ("bit_length", `Int n); ("value", `String digits_str)]
      | Lang.Hexadecimal (n, hexits) ->
        let hexits_str = String.concat "" (List.map string_of_digit hexits) in
        `Assoc [("type", `String "hexadecimal"); ("bit_length", `Int n); ("value", `String hexits_str)]
      | Lang.WithLength (n, v) ->
        `Assoc [("type", `String "with_length"); ("bit_length", `Int n); ("value", `Int v)]
      | Lang.NoLength v ->
        `Assoc [("type", `String "no_length"); ("value", `Int v)]
    in
    `Assoc [("expr_type", `String "literal"); ("literal", lit_json)]
  | Lang.Identifier id ->
    `Assoc [("expr_type", `String "identifier"); ("name", `String id)]
  | Lang.Call (name, args) ->
    let args_json = List.map expr_node_to_json args in
    `Assoc [("expr_type", `String "call");
            ("function_name", `String name);
            ("arguments", `List args_json)]
  | Lang.Assign (lv, n) ->
    let lv_json = lvalue_to_json lv in
    let n_json = expr_node_to_json n in
    `Assoc [("expr_type", `String "assign");
            ("lvalue", lv_json);
            ("value", n_json)]
  | Lang.Binop (op, e1, e2_opt) ->
    let e1_json = expr_node_to_json e1 in
    let e2_json = match e2_opt with
      | `Single e2 -> `List [expr_node_to_json e2]
      | `List exprs -> `List (List.map expr_node_to_json exprs)
    in
    `Assoc [("expr_type", `String "binop");
            ("operator", `String (string_of_binop op));
            ("left", e1_json);
            ("right", e2_json)]
  | Lang.Unop (op, e) ->
    let e_json = expr_node_to_json e in
    `Assoc [("expr_type", `String "unop");
            ("operator", `String (string_of_unop op));
            ("operand", e_json)]
  | Lang.Tuple exprs ->
    let exprs_json = List.map expr_node_to_json exprs in
    `Assoc [("expr_type", `String "tuple");
            ("elements", `List exprs_json)]
  | Lang.Let (ids, e) ->
    let e_json = expr_node_to_json e in
    `Assoc [("expr_type", `String "let");
            ("identifiers", `List (List.map (fun id -> `String id) ids));
            ("value", e_json)]
  | Lang.Join (e1, e2) ->
    let e1_json = expr_node_to_json e1 in
    let e2_json = expr_node_to_json e2 in
    `Assoc [("expr_type", `String "join");
            ("first", e1_json);
            ("second", e2_json)]
  | Lang.Wait (e1, e2) ->
    let e1_json = expr_node_to_json e1 in
    let e2_json = expr_node_to_json e2 in
    `Assoc [("expr_type", `String "wait");
            ("first", e1_json);
            ("second", e2_json)]
  | Lang.Cycle n ->
    `Assoc [("expr_type", `String "cycle");
            ("cycles", `Int n)]
  | Lang.Sync id ->
    `Assoc [("expr_type", `String "sync");
            ("identifier", `String id)]
  | Lang.IfExpr (cond, then_expr, else_expr) ->
    let cond_json = expr_node_to_json cond in
    let then_json = expr_node_to_json then_expr in
    let else_json = expr_node_to_json else_expr in
    `Assoc [("expr_type", `String "if");
            ("condition", cond_json);
            ("then", then_json);
            ("else", else_json)]
  | Lang.TryRecv (ident, recv_pack, e1, e2) ->
    let recv_json = `Assoc [
      ("message_specifier", message_specifier_to_json recv_pack.recv_msg_spec);
    ] in
    let e1_json = expr_node_to_json e1 in
    let e2_json = expr_node_to_json e2 in
    `Assoc [("expr_type", `String "try_recv");
            ("identifier", `String ident);
            ("recv_pack", recv_json);
            ("on_success", e1_json);
            ("on_failure", e2_json)]
  | Lang.TrySend (send_pack, e1, e2) ->
    let send_json = `Assoc [
      ("message_specifier", message_specifier_to_json send_pack.send_msg_spec);
      ("data", expr_node_to_json send_pack.send_data);
    ] in
    let e1_json = expr_node_to_json e1 in
    let e2_json = expr_node_to_json e2 in
    `Assoc [("expr_type", `String "try_send");
            ("send_pack", send_json);
            ("on_success", e1_json);
            ("on_failure", e2_json)]
  | Lang.Construct (spec, e_opt) ->
    let e_json = match e_opt with
      | Some e -> expr_node_to_json e
      | None -> `Null
    in
    `Assoc [("expr_type", `String "construct");
            ("variant_type", `String spec.variant_ty_name);
            ("constructor", `String spec.variant);
            ("value", e_json)]
  | Lang.Record (name, fields, base_opt) ->
    let fields_json = List.map (fun (field_name, field_expr) ->
      `Assoc [("field_name", `String field_name); ("value", expr_node_to_json field_expr)]
    ) fields in
    let base_json = match base_opt with
      | Some base -> expr_node_to_json base
      | None -> `Null
    in
    `Assoc [("expr_type", `String "record");
            ("record_type", `String name);
            ("fields", `List fields_json);
            ("base", base_json)]
  | Lang.Index (arr, idx) ->
    let arr_json = expr_node_to_json arr in
    let idx_json = match idx with
      | Lang.Single e -> `Assoc [("type", `String "single"); ("index", expr_node_to_json e)]
      | Lang.Range (e1, e2) -> `Assoc [("type", `String "range");
                                      ("start", expr_node_to_json e1);
                                      ("end", expr_node_to_json e2)]
    in
    `Assoc [("expr_type", `String "index");
            ("array", arr_json);
            ("index", idx_json)]
  | Lang.Indirect (e, field) ->
    let e_json = expr_node_to_json e in
    `Assoc [("expr_type", `String "indirect");
            ("expression", e_json);
            ("field", `String field)]
  | Lang.Concat exprs ->
    let exprs_json = List.map expr_node_to_json exprs in
    `Assoc [("expr_type", `String "concat");
            ("elements", `List exprs_json)]
  | Lang.Read id ->
    `Assoc [("expr_type", `String "read");
            ("identifier", `String id)]
  | Lang.Debug debug_op ->
    let debug_json = match debug_op with
      | Lang.DebugPrint (msg, exprs) ->
        let exprs_json = List.map expr_node_to_json exprs in
        `Assoc [("type", `String "print");
                ("message", `String msg);
                ("expressions", `List exprs_json)]
      | Lang.DebugFinish ->
        `Assoc [("type", `String "finish")]
    in
    `Assoc [("expr_type", `String "debug");
            ("debug_op", debug_json)]
  | Lang.Send send_pack ->
    let send_json = `Assoc [
      ("message_specifier", message_specifier_to_json send_pack.send_msg_spec);
      ("data", expr_node_to_json send_pack.send_data);
    ] in
    `Assoc [("expr_type", `String "send");
            ("send_pack", send_json)]
  | Lang.Recv recv_pack ->
    let recv_json = `Assoc [
      ("message_specifier", message_specifier_to_json recv_pack.recv_msg_spec);
    ] in
    `Assoc [("expr_type", `String "recv");
            ("recv_pack", recv_json)]
  | Lang.SharedAssign (ident, e) ->
    let e_json = expr_node_to_json e in
    `Assoc [("expr_type", `String "shared_assign");
            ("identifier", `String ident);
            ("value", e_json)]
  | Lang.Recurse ->
    `Assoc [("expr_type", `String "recurse")]
  | Lang.List exprs ->
    let exprs_json = List.map expr_node_to_json exprs in
    `Assoc [("expr_type", `String "list");
            ("elements", `List exprs_json)]
  | Lang.Ready id ->
    `Assoc [("expr_type", `String "ready");
            ("message_specifier", message_specifier_to_json id)]
  | Lang.Probe id ->
    `Assoc [("expr_type", `String "probe");
            ("message_specifier", message_specifier_to_json id)]
  | _ ->
    `Assoc [("expr_type", `String "unknown")]
  in
  `Assoc [
    ("expression", expr);
    ("span", code_span_to_json e.span);
  ]

and lvalue_to_json (lv : Lang.lvalue) : Yojson.Basic.t =
  match lv with
  | Lang.Reg id ->
    `Assoc [("lvalue_type", `String "reg"); ("name", `String id)]
  | Lang.Indexed (lv', idx) ->
    let lv_json = lvalue_to_json lv' in
    let idx_json = match idx with
      | Lang.Single e -> `Assoc [("type", `String "single"); ("index", expr_node_to_json e)]
      | Lang.Range (e1, e2) -> `Assoc [("type", `String "range");
                                      ("start", expr_node_to_json e1);
                                      ("end", expr_node_to_json e2)]
    in
    `Assoc [("lvalue_type", `String "indexed");
            ("base", lv_json);
            ("index", idx_json)]
  | Lang.Indirected (lv', field) ->
    let lv_json = lvalue_to_json lv' in
    `Assoc [("lvalue_type", `String "indirected");
            ("base", lv_json);
            ("field", `String field)]

let func_def_to_json (fd : Lang.func_def) : Yojson.Basic.t =
  let assoc = [
    ("name", `String fd.name);
    ("args", `List (List.map (fun arg -> `String arg) fd.args));
    ("body", expr_node_to_json fd.body);
  ] in
  `Assoc assoc

let proc_def_body_to_json (body : Lang.proc_def_body) : Yojson.Basic.t =
  let assoc = [
    ("channels", `List (List.map
      (fun cd -> channel_def_to_json cd.d)
      body.channels));
    ("spawns", `List (List.map
      (fun sd -> spawn_def_to_json sd.d)
      body.spawns));
    ("regs", `List (List.map
      (fun rd -> reg_def_to_json rd.d)
      body.regs));
    ("shared_vars", `List (List.map
      (fun svd -> shared_var_def_to_json svd.d)
      body.shared_vars));
    ("threads", `List (List.map expr_node_to_json body.threads));
  ] in
  `Assoc assoc

let proc_def_body_extern_to_json (body_extern : Lang.proc_def_body_extern) : Yojson.Basic.t =
  let assoc = [
    ("named_ports", `List (List.map (fun (port_name, signal_name) ->
      `Assoc [("port_name", `String port_name); ("signal_name", `String signal_name)]
    ) body_extern.named_ports));
    ("msg_ports", `List (List.map (fun (msg_spec, data_port, valid_port, ack_port) ->
      let msg_spec_json = message_specifier_to_json msg_spec in
      let data_port_json = match data_port with Some dp -> `String dp | None -> `Null in
      let valid_port_json = match valid_port with Some vp -> `String vp | None -> `Null in
      let ack_port_json = match ack_port with Some ap -> `String ap | None -> `Null in
      `Assoc [
        ("message_specifier", msg_spec_json);
        ("data_port", data_port_json);
        ("valid_port", valid_port_json);
        ("ack_port", ack_port_json);
      ]
    ) body_extern.msg_ports));
  ] in
  `Assoc assoc

let proc_def_to_json (pd : Lang.proc_def) : Yojson.Basic.t =
  let assoc = [
    ("name", `String pd.name);
    ("args", `List (List.map
      (fun ed -> `Assoc [
        ("endpoint", endpoint_def_to_json ed.d);
        ("span", code_span_to_json ed.span)
      ])
      pd.args
    ));
    ("body", (match pd.body with
      | Lang.Native body ->
        `Assoc [("type", `String "native"); ("content", proc_def_body_to_json body)]
      | Lang.Extern (mod_name, body_extern) ->
        `Assoc [("type", `String "extern");
                ("module_name", `String mod_name);
                ("content", proc_def_body_extern_to_json body_extern)]
    ));
    ("params", `List (List.map param_to_json pd.params));
  ] in
  `Assoc assoc

let import_directive_to_json (im : Lang.import_directive) : Yojson.Basic.t =
  let assoc = [
    ("file_name", `String im.file_name);
    ("is_extern", `Bool im.is_extern);
  ] in
  `Assoc assoc

let convert_compilation_unit_to_json (u : Lang.compilation_unit) : Yojson.Basic.t =
   let assoc = [
     ("file_name", match u.cunit_file_name with Some fn -> `String fn | None -> `Null);
     ("channel_classes", `List (List.map (fun cc -> channel_class_def_to_json cc) u.channel_classes));
     ("type_defs", `List (List.map (fun td -> type_def_to_json td) u.type_defs));
     ("macro_defs", `List (List.map (fun md -> macro_def_to_json md) u.macro_defs));
     ("func_defs", `List (List.map (fun fd -> func_def_to_json fd) u.func_defs));
     ("procs", `List (List.map (fun pd -> proc_def_to_json pd) u.procs));
     ("imports", `List (List.map (fun im -> import_directive_to_json im) u.imports));
   ] in
   `Assoc assoc

let convert_compilation_units_to_json (ast_out : (string * Lang.compilation_unit) list) : Yojson.Basic.t =
  let json_cunits = List.map (fun (fname, cunit) ->
    let assoc = [
      ("file_name", `String fname);
      ("compilation_unit", convert_compilation_unit_to_json cunit)
    ] in
    `Assoc assoc
  ) ast_out in
  `List json_cunits

*/

type AnvilParam = {
    name: string;
    type: 'int' | 'type';
};

type AnvilParamValue =
	| { type: 'int'; value: number }
	| { type: 'type'; value: AnvilDataType };

type AnvilSpan = {
    start_line: number;
    start_cnum: number;
    end_line: number;
    end_cnum: number;
};

type AnvilEndpointDirection = 'left' | 'right';
type AnvilMessageDirection = 'in' | 'out';

type AnvilSyncMode =
	| { type: 'dynamic' }
	| { type: 'static'; init_offset: number; interval: number }
	| { type: 'dependent'; message: string; delay: number };

type AnvilMessage = {
	name: string;
	dir: AnvilMessageDirection;
	send_sync: AnvilSyncMode;
	recv_sync: AnvilSyncMode;
	signal_types: {
		dtype: AnvilDataType;
		lifetime:
			| { type: 'cycles'; value: number }
			| { type: 'message'; value: { endpoint: string; message: string } }
			| { type: 'eternal' };
	}[];
	span: AnvilSpan;
};

type AnvilChannelClass = {
    name: string;
    messages: AnvilMessage[];
    params: AnvilParam[];
    span: AnvilSpan;
};

type AnvilType = {
    name: string;
    body: AnvilDataType;
    params: AnvilParam[];
}

type AnvilMacro = {
    id: string;
    value: number;
}

type AnvilFunc = {
    name: string;
    args: string[];
    body: any; // TODO
}

type AnvilDataType =
	| { type: 'logic' }
	| { type: 'array'; element_type: AnvilDataType; size: number | string }
	| { type: 'variant'; constructors: { name: string; type: AnvilDataType | null }[] }
	| { type: 'record'; fields: { name: string; type: AnvilDataType }[] }
	| { type: 'tuple'; elements: AnvilDataType[] }
	| { type: 'opaque'; name: string }
	| { type: 'named'; name: string; params: AnvilParamValue[] };

type AnvilMessageSpecifier = {
	endpoint: string;
	message: string;
};

type AnvilPackType = {
	message_specifier: AnvilMessageSpecifier;
	data: AnvilExprNode;
};

type AnvilIndexType =
	| { type: 'single'; index: AnvilExprNode }
	| { type: 'range'; start: AnvilExprNode; end: AnvilExprNode };

type AnvilExprNode = {
	expression:
		| { type: 'literal'; literal: any } // TODO
		| { type: 'identifier'; name: string }
		| { type: 'call'; function_name: string; arguments: AnvilExprNode[] }
		| { type: 'assign'; lvalue: AnvilLValue; value: AnvilExprNode }
		| { type: 'binop'; operator: string; left: AnvilExprNode; right: AnvilExprNode[] }
		| { type: 'unop'; operator: string; operand: AnvilExprNode }
		| { type: 'tuple'; elements: AnvilExprNode[] }
		| { type: 'let'; identifiers: string[]; value: AnvilExprNode }
		| { type: 'join'; first: AnvilExprNode; second: AnvilExprNode }
		| { type: 'wait'; first: AnvilExprNode; second: AnvilExprNode }
		| { type: 'cycle'; cycles: number }
		| { type: 'sync'; identifier: string }
		| { type: 'if'; condition: AnvilExprNode; then: AnvilExprNode; else: AnvilExprNode }
		| { type: 'try_recv'; identifier: string; recv_pack: AnvilPackType; on_success: AnvilExprNode; on_failure: AnvilExprNode }
		| { type: 'try_send'; send_pack: AnvilPackType; on_success: AnvilExprNode; on_failure: AnvilExprNode }
		| { type: 'construct'; variant_type: string; constructor: string; value: AnvilExprNode | null }
		| { type: 'record'; record_type: string; fields: { field_name: string; value: AnvilExprNode }[]; base: AnvilExprNode | null }
		| { type: 'index'; array: AnvilExprNode; index: AnvilIndexType }
		| { type: 'indirect'; expression: AnvilExprNode; field: string }
		| { type: 'concat'; elements: AnvilExprNode[] }
		| { type: 'read'; identifier: string }
		| { type: 'debug'; debug_op: any } // TODO debug_op
		| { type: 'send'; send_pack: AnvilPackType }
		| { type: 'recv'; recv_pack: AnvilPackType }
		| { type: 'shared_assign'; identifier: string; value: AnvilExprNode }
		| { type: 'recurse' }
		| { type: 'list'; elements: AnvilExprNode[] }
		| { type: 'ready'; message_specifier: { endpoint: string; message: string } }
		| { type: 'probe'; message_specifier: { endpoint: string; message: string } };
	span: AnvilSpan;
}

type AnvilLValue =
	| { type: 'reg'; name: string }
	| { type: 'indexed'; base: AnvilLValue; index: any } // TODO index
	| { type: 'indirected'; base: AnvilLValue; field: string };

type AnvilNativeProcBody = {
    type: 'native';
    content: {
        channels: {
            channel_class: string;
            channel_params: AnvilParamValue[];
            endpoint_left: string;
            endpoint_right: string;
            visibility: 'both_foreign' | 'left_foreign' | 'right_foreign';
        }[];
        spawns: {
            proc: string;
            params: string[];
            compile_params: any[];
        }[];
        regs: {
            name: string;
            dtype: AnvilDataType;
            init: string | null;
        }[];
        shared_vars: {
            ident: string;
            assigning_thread: number;
            shared_lifetime:
                | { type: 'cycles'; value: number }
                | { type: 'message'; value: { endpoint: string; message: string } }
                | { type: 'eternal' };
        }[];
        threads: any[];
    };
}

type AnvilExternProcBody = {
    type: 'extern';
    module_name: string;
    content: {
        named_ports: { port_name: string; signal_name: string }[];
        msg_ports: {
            message_specifier: { endpoint: string; message: string };
            data_port: string | null;
            valid_port: string | null;
            ack_port: string | null;
        }[];
    };
}

type AnvilProc = {
    name: string;
    args: {
        endpoint: {
            name: string;
            channel_class: string;
            channel_params: AnvilParamValue[];
            direction: AnvilEndpointDirection;
            foreign: boolean;
            opposite_endpoint: string | null;
        };
        span: AnvilSpan;
    }[];
    body: AnvilNativeProcBody | AnvilExternProcBody;
    params: AnvilParam[];
}

export type AnvilCompilationUnitNavigation = (string | number)[];

export type AnvilCompilationUnit = {
    file_name: string;
    channel_classes: AnvilChannelClass[];
    type_defs: AnvilType[];
    macro_defs: AnvilMacro[];
    func_defs: AnvilFunc[];
    proc_defs: AnvilProc[];
    imports: {
        file_name: string;
        is_extern: boolean;
    }[];
};

export type AnvilASTOutput = {
    file_name: string;
    compilation_unit: AnvilCompilationUnit;
};

export class AnvilAST {
    private data: AnvilASTOutput[];
	private filenameToIndex: { [filename: string]: number } = {};

	private spanToTreeNavigation: {
		[filename: string]: {
			span: AnvilSpan;
			navigation: (string | number)[];
		}[];
	} = {};

    constructor(data: AnvilASTOutput[]) {
        this.data = data;
		this.data.forEach((item, index) => {
			if (item.file_name) {
				this.filenameToIndex[item.file_name] = index;
				this.traverseAST(item.file_name, item.compilation_unit);
			}
		});

		for (const filename in this.spanToTreeNavigation) {
			this.spanToTreeNavigation[filename].sort((a, b) => {
				if (a.span.start_line !== b.span.start_line) {
					return a.span.start_line - b.span.start_line;
				}
				return a.span.start_cnum - b.span.start_cnum;
			});
		}
    }

    static fromJSONString(json: string): AnvilAST {
        // TODO: Validation
        return new AnvilAST(JSON.parse(json) as AnvilASTOutput[]);
    }

	/**
	 * Get the navigation path to a specific span.
	 * @param span The span to find navigation for
	 * @returns An array of navigation steps or null if not found
	 */
	getNavigationToSpan(filename: string, span: AnvilSpan): AnvilCompilationUnitNavigation | null {
		let bestMatch: {
			span: AnvilSpan;
			navigation: AnvilCompilationUnitNavigation;
		} | null = null;

		for (const entry of this.spanToTreeNavigation[filename] || []) {
			if (this.isSpanBefore(entry.span, span)) { continue; }
			if (this.isSpanAfter(entry.span, span)) { continue; }

			// Current entry.span encloses span!

			if (!bestMatch) {
				// First match
				bestMatch = entry;
			} else {
				// Another match exists
				// Check if this is a narrower match, if so, use it
				const bestSpan = bestMatch.span;
				const entrySpan = entry.span;

				const bestSize = (bestSpan.end_line - bestSpan.start_line) * 1000 + (bestSpan.end_cnum - bestSpan.start_cnum);
				const entrySize = (entrySpan.end_line - entrySpan.start_line) * 1000 + (entrySpan.end_cnum - entrySpan.start_cnum);

				if (entrySize < bestSize) {
					bestMatch = entry;
				}
			}
		}

		// Return the best match found, if any
		if (bestMatch) {
			return bestMatch.navigation;
		}

		return null;
	}

	/**
	 * Get the navigation path to a specific location (line and character number).
	 * @param line The line number (1-based)
	 * @param cnum The character number (1-based)
	 * @returns An array of navigation steps or null if not found
	 */
	getNavigationToLocation(filename: string, line: number, cnum: number): AnvilCompilationUnitNavigation | null {
		return this.getNavigationToSpan(filename, {
			start_line: line,
			start_cnum: cnum,
			end_line: line,
			end_cnum: cnum,
		});
	}

	/**
	 * Get the AST node at a specific navigation path.
	 * @param navigation The navigation path as an array of steps
	 * @param traverseUpward A function that determines whether to traverse upward in the AST. Useful for getting out of nested structures.
	 * @returns The AST node at the specified path or null if not found
	 */
	getInfoForNavigation(
		filename: string,
		navigation: (string | number)[] | null,
		traverseUpward: (node: any) => boolean = () => false
	): any | null {
		if (!navigation) {
			return null;
		}

		const fileIndex = this.filenameToIndex[filename];
		if (fileIndex === undefined) {
			return null;
		}

		let pointers: any[] = [];
		let current: any = this.data[fileIndex].compilation_unit;

		for (const step of navigation) {
			if (current === undefined || current === null) {
				return null;
			}
			pointers.push(current);
			current = current[step];
		}

		// Now current is the node at the navigation path
		// If traverseUpward is true, go up the tree until it returns false or we reach the root
		while (traverseUpward(current) && pointers.length > 0) {
			current = pointers.pop();
		}

		return current;
	}

  getCompilationUnit(filename: string): AnvilCompilationUnit | null {
    const fileIndex = this.filenameToIndex[filename];
    if (fileIndex === undefined) {
      return null;
    }
    return this.data[fileIndex].compilation_unit;
  }

  isExprNode(input: any, navigation: AnvilCompilationUnitNavigation): input is AnvilExprNode {
    return typeof input === 'object' && input !== null && input.expression && input.span;
  }

  isChannelNode(input: any, navigation: AnvilCompilationUnitNavigation): input is AnvilChannelClass {
    return typeof input === 'object' && this.matchNavigation(navigation, ['channel_classes', null]);
  }

  isMessageNode(input: any, navigation: AnvilCompilationUnitNavigation): input is AnvilMessage {
    return typeof input === 'object' && this.matchNavigation(navigation, ['channel_classes', null, 'messages', null]);
  }

  isEndpointNode(input: any, navigation: AnvilCompilationUnitNavigation): input is AnvilProc['args'][0]['endpoint'] {
    return typeof input === 'object' && this.matchNavigation(navigation, ['proc_defs', null, 'args', null]);
  }

  isTypeNode(input: any, navigation: AnvilCompilationUnitNavigation): input is AnvilType {
    return typeof input === 'object' && this.matchNavigation(navigation, ['type_defs', null]);
  }

  isFuncNode(input: any, navigation: AnvilCompilationUnitNavigation): input is AnvilFunc {
    return typeof input === 'object' && this.matchNavigation(navigation, ['func_defs', null]);
  }

  isProcNode(input: any, navigation: AnvilCompilationUnitNavigation): input is AnvilProc {
    return typeof input === 'object' && this.matchNavigation(navigation, ['proc_defs', null]);
  }

  isMacroNode(input: any, navigation: AnvilCompilationUnitNavigation): input is AnvilMacro {
    return typeof input === 'object' && this.matchNavigation(navigation, ['macro_defs', null]);
  }

  private matchNavigation(
    navigation: AnvilCompilationUnitNavigation | null | undefined,
    pattern: (string | number | null)[]
  ): boolean {

    if (!navigation || navigation.length !== pattern.length) {
      return false;
    }
    for (let i = 0; i < pattern.length; i++) {
      if (pattern[i] === null) {
        continue; // Wildcard match
      }

      if (pattern[i] !== navigation[i]) {
        return false;
      }
    }
    return true;
  }

  navigateToDefinitionTree(filename: string, navigation: AnvilCompilationUnitNavigation): AnvilCompilationUnitNavigation[] | null {
    // TODO: Implement full logic.
    // For now, we'll do basic examples:

    let definitionTree: AnvilCompilationUnitNavigation[] = [];

    const expandTree = () => {
      if (definitionTree.length === 0) return;
      const result = this.navigateToDefinitionTree(filename, definitionTree[definitionTree.length - 1]) ?? [];
      definitionTree.push(...result);
      return definitionTree[definitionTree.length - 1];
    }

    const pushAndExpandTree = (nav: AnvilCompilationUnitNavigation) => {
      definitionTree.push(nav);
      return expandTree();
    }


    const node = this.getInfoForNavigation(filename, navigation);
    if (!node) {
      return null;
    }

    if (this.isExprNode(node, navigation)) {
      const expr = node.expression;

      switch (expr.type) {
        case 'send':
        case 'recv':

          const pack =
            expr.type === 'send' ? expr.send_pack :
            expr.type === 'recv' ? expr.recv_pack :
            null;

          if (!pack) {
            return null; // Pack not found! This is invalid.
          }

          const endpointName = pack.message_specifier.endpoint;
          const messageName = pack.message_specifier.message;

          console.log(`Navigating to definition of message '${messageName}' on endpoint '${endpointName}'`);

          // Find the endpoint definition in the proc args
          const procEndpointNodeIndex = this.getCompilationUnit(filename)
            ?.proc_defs[navigation[1] as number]
            ?.args
            .findIndex(arg => arg.endpoint.name === endpointName)
            ?? -1;

          let newNavigationRoot;

          if (procEndpointNodeIndex < 0) {
            return null; // Endpoint not found! This is invalid.
          }

          console.log(`Found endpoint definition at index ${procEndpointNodeIndex}`);
          newNavigationRoot = pushAndExpandTree([...navigation.slice(0, 2), 'args', procEndpointNodeIndex]);

          const channelClassIndex = this.matchNavigation(newNavigationRoot, ['channel_classes', null]) ? newNavigationRoot?.[1] as number ?? -1 : -1;

          // Find the message definition in the channel class
          const messageIndex = this.getCompilationUnit(filename)
            ?.channel_classes[channelClassIndex]
            ?.messages
            .findIndex(msg => msg.name === messageName)
            ?? -1;

          if (messageIndex >= 0) {
            console.log(`Found message definition at index ${messageIndex}`);
            pushAndExpandTree(['channel_classes', channelClassIndex, 'messages', messageIndex]);
          }
      }

    } else if (this.isEndpointNode(node, navigation)) {
      // Find the channel class definition
      const channelClassName = this.getInfoForNavigation(filename, [...navigation.slice(0, 4), 'endpoint', 'channel_class']) as string;
      const channelClassIndex = this.getCompilationUnit(filename)
        ?.channel_classes
        .findIndex(cc => cc.name === channelClassName)
        ?? -1;

      if (channelClassIndex >= 0) {
        console.log(`Found channel class definition at index ${channelClassIndex}`);
        definitionTree.push(['channel_classes', channelClassIndex]);
        expandTree();
      }
    }

    return definitionTree;
  }

	private isSpanBefore(a: AnvilSpan, b: AnvilSpan): boolean {
		if (a.end_line < b.start_line) return true;
		if (a.end_line === b.start_line && a.end_cnum < b.start_cnum) return true;
		return false;
	}

	private isSpanAfter(a: AnvilSpan, b: AnvilSpan): boolean {
		if (a.start_line > b.end_line) return true;
		if (a.start_line === b.end_line && a.start_cnum > b.end_cnum) return true;
		return false;
	}

  private traverseAST(filename: string, node: unknown, path: (string | number)[] = []) {
    if (typeof (node as any).span === 'object' && (node as any).span) {
      const arr = this.spanToTreeNavigation[filename] || []
      this.spanToTreeNavigation[filename] = arr;

      arr.push({ span: (node as any).span, navigation: path });
    }

		if (Array.isArray(node)) {
      node.forEach((elem, index) => this.traverseAST(filename, elem, [...path, index]));
			return;
		}

		if (typeof node === 'object') {
			for (const key in node) {
        const value = (node as any)[key];

        // Only traverse into objects and arrays, skip primitives and null
				if (typeof value === 'object' && value !== null) {
					this.traverseAST(filename, value, [...path, key]);
				}
			}
			return;
		}
    }

    toJSON(): string {
        return JSON.stringify(this.data, null, 2);
    }
}