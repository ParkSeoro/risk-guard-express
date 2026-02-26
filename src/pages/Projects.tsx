import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { sampleProject } from "@/data/mockData";
import { Calendar, Building2, Users, Tag } from "lucide-react";

const Projects = () => {
  const project = sampleProject;
  return (
    <div className="space-y-4 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold">프로젝트 관리</h1>
        <p className="text-sm text-muted-foreground mt-1">현장/공사 프로젝트 목록</p>
      </div>

      <Card className="hover:shadow-md transition-shadow">
        <CardContent className="pt-5">
          <div className="flex items-start justify-between">
            <div className="space-y-3">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-bold">{project.name}</h2>
                  <Badge className="bg-success text-success-foreground text-[10px]">{project.status}</Badge>
                </div>
                <p className="text-sm text-muted-foreground mt-0.5">{project.siteName}</p>
              </div>
              <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Calendar className="h-3.5 w-3.5" />
                  <span>{project.period.start} ~ {project.period.end}</span>
                </div>
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Building2 className="h-3.5 w-3.5" />
                  <span>발주사: {project.client}</span>
                </div>
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Users className="h-3.5 w-3.5" />
                  <span>시공사: {project.contractor}</span>
                </div>
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Users className="h-3.5 w-3.5" />
                  <span>협력사: {project.subcontractors.join(', ')}</span>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <Tag className="h-3 w-3 text-muted-foreground" />
                {project.tags.map(tag => (
                  <Badge key={tag} variant="outline" className="text-[10px]">{tag}</Badge>
                ))}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default Projects;
