package com.cinepulse.mobile;

import org.json.JSONArray;
import org.json.JSONObject;

/** Never infer a successful POST from a 2xx response without a verified project receipt. */
final class CloudProjectReceipt {
    private CloudProjectReceipt(){}
    private static String firstId(JSONObject object,boolean allowBareId){
        if(object==null)return "";
        String[] fields=allowBareId?new String[]{"id","projectId","project_id"}:
            new String[]{"projectId","project_id"};
        for(String key:fields){
            String candidate=object.optString(key,"");
            if(SecurityRules.validUuid(candidate))return candidate;
        }
        return "";
    }
    static String confirmedId(JSONObject response){
        if(response==null||response.optBoolean("success",true)==false||
            response.optBoolean("ok",true)==false)return "";
        String direct=firstId(response,true);
        if(!direct.isEmpty())return direct;
        JSONObject[] containers={response.optJSONObject("project"),response.optJSONObject("data"),
            response.optJSONObject("result"),response.optJSONObject("payload")};
        for(JSONObject container:containers){
            String value=firstId(container,true);
            if(!value.isEmpty())return value;
            String nested=firstId(container==null?null:container.optJSONObject("project"),true);
            if(!nested.isEmpty())return nested;
        }
        return "";
    }
    /** Only unambiguous matching titles can reconcile an unknown POST without resubmitting. */
    static String matchingProjectId(JSONArray projects,String title){
        if(projects==null)return "";
        String only="";
        for(int i=0;i<projects.length();i++){
            JSONObject item=projects.optJSONObject(i);
            if(item==null||!SecurityRules.validUuid(item.optString("id")))continue;
            if(!MovieIdentity.sameMovie(title,item.optString("title")))continue;
            String id=item.optString("id");
            if(!only.isEmpty()&&!only.equals(id))return "";
            only=id;
        }
        return only;
    }
    static int matchingCount(JSONArray projects,String title){
        if(projects==null)return 0;int count=0;
        for(int i=0;i<projects.length();i++){
            JSONObject item=projects.optJSONObject(i);
            if(item!=null&&MovieIdentity.sameMovie(title,item.optString("title")))count++;
        }
        return count;
    }
}
